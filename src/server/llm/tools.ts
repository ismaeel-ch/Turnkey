/**
 * Tool calling behind one interface.
 *
 * A request may carry `tools`. Whether the provider does native tool calling or not, the caller gets the same
 * `tool_call` chunks back. Where the provider has no native tool calling (or the model fails at it), the JSON
 * protocol below is used: the tools are described in the system prompt and the model answers with one JSON object.
 *
 *   LLM_TOOL_MODE   auto (default: probe once per provider and model, remember the result) | native | json
 */
import {
  LlmError,
  type ChatChunk,
  type ChatMessage,
  type ChatRequest,
  type Provider,
  type Tier,
  type ToolCall,
  type ToolDef,
  type ToolMode,
} from './types';

type Env = Record<string, string | undefined>;

export function toolModeSetting(env: Env = process.env): 'auto' | ToolMode {
  const v = (env.LLM_TOOL_MODE || '').trim().toLowerCase();
  return v === 'native' || v === 'json' ? v : 'auto';
}

/** What `auto` learned, by `provider:model`. Lives as long as the server instance. */
const learned = new Map<string, ToolMode>();
export const forgetToolModes = () => learned.clear();

const PROBE_TOOL: ToolDef = {
  name: 'report_ready',
  description: 'Call this tool to say you are ready.',
  parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
};

/** The text added to the system prompt when tools go by JSON. */
export function jsonProtocol(tools: ToolDef[], choice: ChatRequest['toolChoice']): string {
  const list = tools
    .map((t) => '- ' + t.name + ': ' + t.description + '\n  arguments (JSON Schema): ' + JSON.stringify(t.parameters))
    .join('\n');
  return (
    'You can use these tools:\n' +
    list +
    '\n\nTo use one or more tools, reply with ONLY this JSON object and nothing else, no code fence:\n' +
    '{"tool_calls":[{"name":"<tool name>","arguments":{...}}]}\n' +
    (choice === 'required' ? 'You must call a tool.' : 'If you do not need a tool, answer in plain text instead.') +
    '\nWhen a tool result arrives in a message that starts with "TOOL RESULT", use it to continue.'
  );
}

/** Pulls the first balanced JSON object out of a reply, ignoring prose and code fences around it. */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Reads a JSON-protocol reply. Returns null when the reply is plain text (or calls a tool that does not exist). */
export function parseToolReply(text: string, tools: ToolDef[], newId: () => string): ToolCall[] | null {
  const obj = firstJsonObject(text) as { tool_calls?: unknown } | undefined;
  if (!obj || !Array.isArray(obj.tool_calls)) return null;
  const known = new Set(tools.map((t) => t.name));
  const calls: ToolCall[] = [];
  for (const raw of obj.tool_calls) {
    const c = raw as { name?: unknown; arguments?: unknown; args?: unknown };
    if (typeof c?.name !== 'string' || !known.has(c.name)) return null;
    let args = c.arguments ?? c.args ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        // keep the raw string
      }
    }
    calls.push({ id: newId(), name: c.name, args });
  }
  return calls.length ? calls : null;
}

/** Rewrites a conversation with tool turns into one a model with no tool calling can follow. */
export function toJsonMessages(messages: ChatMessage[], tools: ToolDef[], choice: ChatRequest['toolChoice']): ChatMessage[] {
  const names = new Map<string, string>();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      m.toolCalls.forEach((c) => names.set(c.id, c.name));
      out.push({
        role: 'assistant',
        content: JSON.stringify({ tool_calls: m.toolCalls.map((c) => ({ name: c.name, arguments: c.args })) }),
      });
    } else if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: 'TOOL RESULT for ' + (names.get(m.toolCallId || '') || m.toolCallId || 'a tool') + ':\n' + m.content,
      });
    } else out.push({ role: m.role, content: m.content });
  }
  const note = jsonProtocol(tools, choice);
  const at = out.findIndex((m) => m.role === 'system');
  if (at >= 0) out[at] = { role: 'system', content: out[at].content + '\n\n' + note };
  else out.unshift({ role: 'system', content: note });
  return out;
}

let counter = 0;
const nextId = () => 'call_json_' + ++counter;

/** Streams a request through the JSON protocol. The reply is buffered: it cannot be told from plain text until it ends. */
async function* streamJson(inner: Provider, request: ChatRequest, tools: ToolDef[]): AsyncGenerator<ChatChunk> {
  let text = '';
  let done: Extract<ChatChunk, { type: 'done' }> | null = null;
  for await (const chunk of inner.stream({
    ...request,
    tools: undefined,
    toolChoice: undefined,
    messages: toJsonMessages(request.messages, tools, request.toolChoice),
  })) {
    if (chunk.type === 'delta') text += chunk.text;
    else if (chunk.type === 'done') done = chunk;
  }
  const calls = parseToolReply(text, tools, nextId);
  if (calls) for (const call of calls) yield { type: 'tool_call', call };
  else if (text) yield { type: 'delta', text };
  yield done ?? { type: 'done', truncated: false };
}

async function probeNative(inner: Provider, tier: Tier): Promise<ToolMode> {
  try {
    for await (const chunk of inner.stream({
      messages: [{ role: 'user', content: 'Call the report_ready tool with the word "ready". Do not answer in text.' }],
      tier,
      maxTokens: 64,
      tools: [PROBE_TOOL],
      toolChoice: 'required',
    })) {
      if (chunk.type === 'tool_call') return 'native';
    }
    return 'json';
  } catch (e) {
    // A refusal of the key or the budget says nothing about tools: let the real call report it.
    if (e instanceof LlmError && (e.code === 'unauthorized' || e.code === 'budget' || e.code === 'rate_limited' || e.code === 'aborted'))
      throw e;
    return 'json';
  }
}

/** Which way tools will go for this provider and tier. Probes at most once per provider and model. */
export async function toolModeFor(inner: Provider, tier: Tier, env: Env = process.env): Promise<ToolMode> {
  const setting = toolModeSetting(env);
  if (setting === 'json') return 'json';
  if (inner.fixedToolMode) return inner.fixedToolMode;
  if (setting === 'native') return inner.nativeTools ? 'native' : 'json';
  if (!inner.nativeTools) return 'json';
  const key = inner.id + ':' + inner.model(tier);
  const known = learned.get(key);
  if (known) return known;
  const mode = await probeNative(inner, tier);
  learned.set(key, mode);
  return mode;
}

/**
 * Wraps a provider so that `tools` work whatever it supports. Requests without tools go straight through.
 * A provider that is already wrapped is returned as it is.
 */
export function withTools(inner: Provider, env: Env = process.env): Provider {
  if ((inner as Provider & { wrapped?: boolean }).wrapped) return inner;
  const wrapped: Provider & { wrapped: true } = {
    wrapped: true,
    id: inner.id,
    nativeTools: true,
    model: (tier) => inner.model(tier),
    toolMode: (tier) => toolModeFor(inner, tier, env),
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const tools = request.tools?.length && request.toolChoice !== 'none' ? request.tools : undefined;
      if (!tools) {
        yield* inner.stream({ ...request, tools: undefined, toolChoice: undefined });
        return;
      }
      const mode = await toolModeFor(inner, request.tier, env);
      if (mode === 'json') {
        yield* streamJson(inner, request, tools);
        return;
      }
      try {
        yield* inner.stream(request);
      } catch (e) {
        // The model or gateway refused the tool fields: remember, and go by JSON from now on. Only when nothing was sent yet.
        if (e instanceof LlmError && e.code === 'bad_request' && toolModeSetting(env) === 'auto') {
          learned.set(inner.id + ':' + inner.model(request.tier), 'json');
          yield* streamJson(inner, request, tools);
          return;
        }
        throw e;
      }
    },
  };
  return wrapped;
}
