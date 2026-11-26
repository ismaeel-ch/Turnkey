/**
 * A stand-in that needs no key and no network. For tests and for running the app with `LLM_PROVIDER=mock`.
 *
 * A prompt from one of Turnkey's agents ("You are the <Name> agent on Turnkey…") gets a valid saved answer for that
 * role (see mock-roles.ts). Any other prompt gets a small JSON echo. A request with `tools` makes one tool call with
 * made-up arguments that fit the schema, then answers in text once a tool result is in the conversation.
 */
import type { ChatChunk, ChatRequest, Provider, ToolCall, ToolDef } from '../types';
import { roleAnswer } from './mock-roles';

/** Arguments that fit a JSON Schema, as plainly as possible. */
export function sampleArgs(schema: unknown, depth = 0): unknown {
  const s = (schema && typeof schema === 'object' ? schema : {}) as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'object' || (!type && s.properties)) {
    const props = (s.properties && typeof s.properties === 'object' ? s.properties : {}) as Record<string, unknown>;
    const required = Array.isArray(s.required) ? (s.required as string[]) : Object.keys(props);
    const out: Record<string, unknown> = {};
    if (depth < 4) for (const k of required) out[k] = sampleArgs(props[k], depth + 1);
    return out;
  }
  if (type === 'array') return depth < 4 && s.items ? [sampleArgs(s.items, depth + 1)] : [];
  if (type === 'number' || type === 'integer') return 1;
  if (type === 'boolean') return true;
  return 'sample';
}

const echo = (text: string) => JSON.stringify({ mock: true, echo: text.slice(0, 80) });

export function mockProvider(reply?: (request: ChatRequest) => string): Provider {
  let n = 0;
  return {
    id: 'mock',
    nativeTools: true,
    model: (tier) => 'mock-' + tier,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const tools: ToolDef[] = request.tools?.length && request.toolChoice !== 'none' ? request.tools : [];
      const answered = request.messages.some((m) => m.role === 'tool');
      if (tools.length && !answered && !reply) {
        const tool = tools[0];
        const call: ToolCall = { id: 'mock_call_' + ++n, name: tool.name, args: sampleArgs(tool.parameters) };
        yield { type: 'tool_call', call };
        yield { type: 'done', truncated: false, usage: { input: Math.ceil(lastUser.length / 4), output: 20 } };
        return;
      }
      const text = reply ? reply(request) : answered ? 'Done.' : (roleAnswer(lastUser) ?? echo(lastUser));
      const size = Math.max(1, Math.ceil(text.length / 3));
      for (let i = 0; i < text.length; i += size) yield { type: 'delta', text: text.slice(i, i + size) };
      yield { type: 'done', truncated: false, usage: { input: Math.ceil(lastUser.length / 4), output: Math.ceil(text.length / 4) } };
    },
  };
}
