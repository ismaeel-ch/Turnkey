/**
 * The Claude Code command line as a model, so the whole app can run against a real model on a developer's machine
 * before gateway credentials exist. Provider id `claude-code`. DEVELOPMENT ONLY: it uses the developer's own Claude
 * login and is refused when NODE_ENV is production or VERCEL is set.
 *
 *   claude -p [--bare] --no-session-persistence --output-format stream-json --verbose --include-partial-messages
 *          --model <alias> --effort low --max-budget-usd 0.50 --tools "" [--system-prompt ...] [--json-schema ...]
 *
 * - The prompt goes in on standard input, never on the command line. No shell is involved.
 * - Plain requests stream text as it arrives (`content_block_delta` events).
 * - Requests with tools are answered through `--json-schema`: the model returns `{tool_calls:[...]}` or `{text}` and
 *   this file turns that back into the gateway's `tool_call` chunks. No real Claude Code tool is ever enabled.
 * - At most three attempts per step, and only for failures worth repeating (a timeout, a crash, unreadable output).
 * - `--bare` skips the user's login and reads only ANTHROPIC_API_KEY, so it is added only when that variable is set.
 * - `--effort` follows the tier (`default` → medium, `quick` → low) unless the request or the config names one.
 * - The command caches the system prompt itself; usage reports cache reads and writes, and `total_cost_usd` is
 *   passed on as the call's cost.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { effortFor } from '../features';
import { parseToolReply } from '../tools';
import {
  LlmError,
  type ChatChunk,
  type ChatMessage,
  type ChatRequest,
  type Effort,
  type Provider,
  type Tier,
  type ToolDef,
  type Usage,
} from '../types';

export type ClaudeCodeConfig = {
  /** Model alias for the command: `sonnet`, `haiku`, `opus` or a full name. */
  model: string;
  quickModel?: string;
  /** The executable. Default `claude`, found on PATH. */
  command?: string;
  timeoutMs?: number;
  /** Highest spend for one step, in US dollars. Default 0.50. */
  maxBudgetUsd?: number;
  /** One effort for every call. Unset: each request's own, else its tier's (see features.ts). */
  effort?: Effort;
  /** Force `--bare` on or off. Default: on when ANTHROPIC_API_KEY is set (bare mode cannot use a login). */
  bare?: boolean;
  env?: Record<string, string | undefined>;
  /** For tests: replaces child_process.spawn. */
  spawnImpl?: SpawnFn;
  sleep?: (ms: number) => Promise<void>;
};

export type SpawnFn = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams;

export const MAX_ATTEMPTS = 3;

/** Throws when this looks like a deployment: the command runs as whoever started the server. */
export function assertLocal(env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL || env.NODE_ENV === 'production')
    throw new LlmError(
      'not_configured',
      'the claude-code provider is for local development only and is refused in production and on Vercel',
      503,
    );
}

/** The command line, without the prompt. */
export function buildArgs(o: {
  model: string;
  system?: string;
  schema?: Record<string, unknown>;
  bare: boolean;
  maxBudgetUsd: number;
  effort: string;
}): string[] {
  const args = ['-p'];
  if (o.bare) args.push('--bare');
  args.push(
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--verbose', // stream-json needs it
    '--include-partial-messages',
    '--model',
    o.model,
    '--effort',
    o.effort,
    '--max-budget-usd',
    String(o.maxBudgetUsd),
    '--tools',
    '',
  );
  if (o.system) args.push('--system-prompt', o.system);
  if (o.schema) args.push('--json-schema', JSON.stringify(o.schema));
  return args;
}

/** The JSON Schema the answer must follow when a request has tools. */
export function toolReplySchema(tools: ToolDef[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      tool_calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string', enum: tools.map((t) => t.name) }, arguments: { type: 'object' } },
          required: ['name', 'arguments'],
        },
      },
      text: { type: 'string' },
    },
  };
}

/** Added to the system prompt (the stable part, so it caches) when a request has tools. */
export function toolInstructions(tools: ToolDef[], choice: ChatRequest['toolChoice']): string {
  const list = tools.map((t) => `- ${t.name}: ${t.description}\n  arguments (JSON Schema): ${JSON.stringify(t.parameters)}`).join('\n');
  return (
    'Tools for this conversation. They are NOT tools you can call directly in this session: to use one, put it in ' +
    'the structured answer.\n' +
    list +
    '\n\nAnswer with the structured object. To use tools, fill "tool_calls" with {"name", "arguments"} entries, one per call. ' +
    (choice === 'required'
      ? 'You must call at least one tool. '
      : 'If no tool is needed, leave "tool_calls" out and put your answer in "text". ') +
    'A message that starts with "TOOL RESULT" is the answer to an earlier call.'
  );
}

/** The conversation as one piece of text for standard input. The changing part goes last. */
export function renderPrompt(messages: ChatMessage[]): string {
  const rest = messages.filter((m) => m.role !== 'system');
  if (rest.length === 1 && rest[0].role === 'user') return rest[0].content;
  const names = new Map<string, string>();
  const lines = rest.map((m) => {
    if (m.role === 'assistant') {
      m.toolCalls?.forEach((c) => names.set(c.id, c.name));
      const calls = m.toolCalls?.length
        ? JSON.stringify({ tool_calls: m.toolCalls.map((c) => ({ name: c.name, arguments: c.args })) })
        : '';
      return 'Assistant: ' + [m.content, calls].filter(Boolean).join('\n');
    }
    if (m.role === 'tool') return `TOOL RESULT for ${names.get(m.toolCallId || '') || m.toolCallId || 'a tool'}:\n${m.content}`;
    return 'User: ' + m.content;
  });
  return lines.join('\n\n') + '\n\nAssistant:';
}

type ResultLine = {
  type?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  subtype?: string;
  terminal_reason?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  total_cost_usd?: number;
};

/** The result line's usage in the gateway's terms, with the command's own cost. */
export function resultUsage(r: ResultLine): Usage | undefined {
  if (!r.usage) return undefined;
  const u: Usage = { input: r.usage.input_tokens, output: r.usage.output_tokens };
  if (r.usage.cache_read_input_tokens) u.cacheRead = r.usage.cache_read_input_tokens;
  if (r.usage.cache_creation_input_tokens) u.cacheWrite = r.usage.cache_creation_input_tokens;
  if (typeof r.total_cost_usd === 'number' && Number.isFinite(r.total_cost_usd)) u.costUsd = r.total_cost_usd;
  return u;
}

/** One line of the command's output. Returns the text delta, or the final result, or nothing. */
export function readLine(line: string): { delta: string } | { result: ResultLine } | null {
  let obj: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string } } } & ResultLine;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj.type === 'result') return { result: obj };
  const d = obj.type === 'stream_event' && obj.event?.type === 'content_block_delta' ? obj.event.delta : undefined;
  if (d?.type === 'text_delta' && d.text) return { delta: d.text };
  return null;
}

const NO_RETRY = new Set(['unauthorized', 'not_configured', 'budget', 'aborted', 'bad_request']);

function failure(r: ResultLine): LlmError {
  const reason = r.terminal_reason || r.subtype || 'error';
  const text = reason + ' ' + (r.result || '');
  if (/budget/i.test(r.subtype || '')) return new LlmError('budget', 'the claude command reached its spending limit for this step', 429);
  if (/auth|login|api key/i.test(text)) return new LlmError('unauthorized', 'the claude command is not signed in', 401);
  return new LlmError('upstream', 'the claude command failed: ' + reason);
}

let counter = 0;

export function claudeCode(config: ClaudeCodeConfig): Provider {
  const env = config.env ?? process.env;
  assertLocal(env);
  const model = (tier: Tier) => (tier === 'quick' && config.quickModel ? config.quickModel : config.model);
  const run = config.spawnImpl ?? (spawn as unknown as SpawnFn);
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** One attempt: yields text deltas as they arrive and returns the final result line. */
  async function* attempt(args: string[], prompt: string, signal?: AbortSignal): AsyncGenerator<string, ResultLine> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = run(config.command || 'claude', args, {
        env: { ...process.env, ...env } as NodeJS.ProcessEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new LlmError('upstream', 'the claude command could not be started');
    }
    const queue: ({ delta: string } | { result: ResultLine } | { error: LlmError } | { end: true })[] = [];
    let wake: (() => void) | null = null;
    const push = (item: (typeof queue)[number]) => (queue.push(item), wake?.(), (wake = null));
    let buffer = '';
    let finished = false;
    const timer = setTimeout(
      () => (child.kill('SIGKILL'), push({ error: new LlmError('upstream', 'the claude command took too long') })),
      config.timeoutMs ?? 180_000,
    );
    const onAbort = () => (child.kill('SIGKILL'), push({ error: new LlmError('aborted', 'the call was stopped', 499) }));
    signal?.addEventListener('abort', onAbort, { once: true });
    const feed = (line: string) => {
      const got = line.trim() ? readLine(line) : null;
      if (got) push(got);
    };
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        feed(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
    });
    child.stderr.on('data', () => undefined); // never kept: it can echo the prompt
    child.on('error', () => push({ error: new LlmError('not_configured', 'the claude command was not found on this machine', 503) }));
    child.on('close', () => (feed(buffer), (buffer = ''), push({ end: true })));
    child.stdin.on('error', () => undefined);
    child.stdin.end(prompt);

    try {
      for (;;) {
        while (!queue.length) await new Promise<void>((r) => (wake = r));
        const item = queue.shift()!;
        if ('delta' in item) yield item.delta;
        else if ('result' in item) {
          finished = true;
          return item.result;
        } else if ('error' in item) throw item.error;
        else throw new LlmError('upstream', 'the claude command ended without an answer');
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!finished) child.kill('SIGKILL');
    }
  }

  return {
    id: 'claude-code',
    nativeTools: true,
    fixedToolMode: 'native', // tools go through --json-schema inside this file: nothing to probe
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      assertLocal(env);
      const tools = request.tools?.length && request.toolChoice !== 'none' ? request.tools : undefined;
      const system = [
        request.messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n'),
        tools ? toolInstructions(tools, request.toolChoice) : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const args = buildArgs({
        model: model(request.tier),
        system,
        schema: tools ? toolReplySchema(tools) : undefined,
        bare: config.bare ?? Boolean(env.ANTHROPIC_API_KEY),
        maxBudgetUsd: config.maxBudgetUsd ?? 0.5,
        effort: config.effort ?? effortFor(request),
      });
      const prompt = renderPrompt(request.messages);

      let lastError: LlmError | null = null;
      for (let n = 1; n <= MAX_ATTEMPTS; n++) {
        let sent = false;
        try {
          const it = attempt(args, prompt, request.signal);
          let step = await it.next();
          while (!step.done) {
            // Text from a structured answer is JSON: it is held back and sent once it has been read.
            if (!tools) {
              sent = true;
              yield { type: 'delta', text: step.value };
            }
            step = await it.next();
          }
          const r = step.value;
          if (r.is_error || (typeof r.result !== 'string' && r.structured_output === undefined)) throw failure(r);
          const usage = resultUsage(r);
          const truncated = r.stop_reason === 'max_tokens';
          if (!tools) {
            if (!sent && r.result) yield { type: 'delta', text: r.result };
            yield { type: 'done', truncated, usage };
            return;
          }
          const raw = r.structured_output !== undefined ? JSON.stringify(r.structured_output) : (r.result as string);
          const calls = parseToolReply(raw, tools, () => 'call_cc_' + ++counter);
          if (calls) for (const call of calls) yield { type: 'tool_call', call };
          else {
            const text = textOf(raw);
            if (text) yield { type: 'delta', text };
          }
          yield { type: 'done', truncated, usage };
          return;
        } catch (e) {
          const error = e instanceof LlmError ? e : new LlmError('upstream', 'the claude command failed');
          // Once text has reached the caller, a second attempt would repeat it.
          if (NO_RETRY.has(error.code) || sent || n === MAX_ATTEMPTS) throw error;
          lastError = error;
          await sleep(500 * n);
        }
      }
      throw lastError ?? new LlmError('upstream', 'the claude command failed');
    },
  };
}

/** The `text` of a structured answer, or the raw reply when it is not JSON. */
function textOf(raw: string): string {
  try {
    const o = JSON.parse(raw) as { text?: unknown };
    if (o && typeof o === 'object') return typeof o.text === 'string' ? o.text : '';
  } catch {
    // plain text
  }
  return raw;
}
