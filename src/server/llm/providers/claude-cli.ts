/**
 * The Claude Code command line as a model, for testing on a developer's own machine: `claude -p --output-format json`.
 * It uses the developer's own Claude login, so it must never run on a deployment: it is refused when VERCEL is set.
 * Not streamed (the command answers once, at the end), so the answer comes as one piece. The prompt goes in on
 * standard input, never on the command line, so it does not show up in a process list.
 */
import { spawn } from 'node:child_process';
import { LlmError, type ChatChunk, type ChatRequest, type Provider, type Tier } from '../types';

export type ClaudeCliConfig = {
  /** Model alias for the CLI: `sonnet`, `opus`, `haiku` or a full name. */
  model: string;
  quickModel?: string;
  /** The executable. Default `claude`, found on PATH. */
  command?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
};

/** Throws if this looks like a deployment. */
export function assertLocal(env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL) throw new LlmError('not_configured', 'the Claude Code provider is for local testing only and is refused on Vercel', 503);
}

type CliResult = {
  is_error?: boolean;
  result?: string;
  subtype?: string;
  terminal_reason?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function claudeCli(config: ClaudeCliConfig): Provider {
  const env = config.env ?? process.env;
  assertLocal(env);
  const model = (tier: Tier) => (tier === 'quick' && config.quickModel ? config.quickModel : config.model);

  return {
    id: 'claude-cli',
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      assertLocal(env);
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = request.messages.filter((m) => m.role !== 'system');
      // A single user message goes in as it is; a longer conversation is written out as a transcript.
      const prompt =
        rest.length === 1 && rest[0].role === 'user'
          ? rest[0].content
          : rest
              .map((m) => (m.role === 'user' ? 'User: ' : m.role === 'assistant' ? 'Assistant: ' : 'Tool result: ') + m.content)
              .join('\n\n') + '\n\nAssistant:';
      const args = ['-p', '--output-format', 'json', '--model', model(request.tier), '--no-session-persistence', '--tools', ''];
      if (system) args.push('--system-prompt', system);

      const out = await new Promise<string>((resolve, reject) => {
        let child;
        try {
          child = spawn(config.command || 'claude', args, {
            env: { ...process.env, ...env } as NodeJS.ProcessEnv,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch {
          return reject(new LlmError('upstream', 'the claude command could not be started'));
        }
        let stdout = '';
        const timer = setTimeout(
          () => (child.kill('SIGKILL'), reject(new LlmError('upstream', 'the claude command took too long'))),
          config.timeoutMs ?? 180_000,
        );
        const abort = () => (child.kill('SIGKILL'), reject(new LlmError('aborted', 'the call was stopped', 499)));
        request.signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        child.stderr.on('data', () => undefined); // never kept: it can echo the prompt
        child.on(
          'error',
          () => (clearTimeout(timer), reject(new LlmError('not_configured', 'the claude command was not found on this machine', 503))),
        );
        child.on('close', () => (clearTimeout(timer), request.signal?.removeEventListener('abort', abort), resolve(stdout)));
        child.stdin.on('error', () => undefined);
        child.stdin.end(prompt);
      });

      let parsed: CliResult;
      try {
        parsed = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || '') as CliResult;
      } catch {
        throw new LlmError('upstream', 'the claude command did not answer with JSON');
      }
      if (parsed.is_error || typeof parsed.result !== 'string') {
        const reason = parsed.terminal_reason || parsed.subtype || 'error';
        if (/auth|login/i.test(reason + ' ' + (parsed.result || '')))
          throw new LlmError('unauthorized', 'the claude command is not signed in', 401);
        throw new LlmError('upstream', 'the claude command failed: ' + reason);
      }
      if (parsed.result) yield { type: 'delta', text: parsed.result };
      yield {
        type: 'done',
        truncated: parsed.stop_reason === 'max_tokens',
        usage: parsed.usage ? { input: parsed.usage.input_tokens, output: parsed.usage.output_tokens } : undefined,
      };
    },
  };
}
