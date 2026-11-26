/** The contract every model provider implements. Server only: nothing here may be imported by browser code. */

/** `default` is the careful model, `quick` the cheap fast one. The workspace sends one or the other. */
export type Tier = 'default' | 'quick';

/**
 * A message. Plain `{ role, content }` still works everywhere. For tool use, an assistant message may carry the
 * `toolCalls` it made, and the answer to each goes back as a `tool` message with the matching `toolCallId`.
 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};

/** A tool the model may call. `parameters` is a JSON Schema object. */
export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };

/** A tool call made by the model. `args` is parsed JSON (an object when the model followed the schema). */
export type ToolCall = { id: string; name: string; args: unknown };

/**
 * Note: there is no `temperature`. Current Claude models (Sonnet and Haiku 5.5) reject any value but the default, so it
 * is never sent. `toolChoice` is `auto` unless a caller asks otherwise; nothing here forces a tool by name.
 */
export type ChatRequest = {
  messages: ChatMessage[];
  tier: Tier;
  maxTokens?: number;
  /** Optional. Works with every provider: native tool calls where supported, a JSON protocol otherwise. */
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | 'required';
  signal?: AbortSignal;
};

export type Usage = { input?: number; output?: number };

/** `tool_call` chunks arrive (whole, never in pieces) only when the request had `tools`, before `done`. */
export type ChatChunk =
  { type: 'delta'; text: string } | { type: 'tool_call'; call: ToolCall } | { type: 'done'; truncated: boolean; usage?: Usage };

/** What `complete()` returns: the whole answer collected from a stream. */
export type Completion = { text: string; truncated: boolean; usage?: Usage; toolCalls: ToolCall[] };

/** How tools reach the model: the provider's own tool calling, or the JSON protocol in tools.ts. */
export type ToolMode = 'native' | 'json';

export interface Provider {
  /** `litellm`, `openai`, `anthropic`, `claude-code` or `mock`. */
  readonly id: string;
  /** Set by a provider that handles `tools` itself in a fixed way, so there is nothing to probe. */
  readonly fixedToolMode?: ToolMode;
  /** Set by providers that can do native tool calling. resolveProvider() wraps providers so `tools` always works. */
  readonly nativeTools?: boolean;
  /** The model name used for a tier. Safe to show: it is not a secret. */
  model(tier: Tier): string;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** Set by providers from resolveProvider(): how tools reach the model for a tier (probes once, then remembers). */
  toolMode?(tier: Tier): Promise<ToolMode>;
}

export type LlmErrorCode = 'not_configured' | 'unauthorized' | 'rate_limited' | 'budget' | 'bad_request' | 'upstream' | 'aborted';

export class LlmError extends Error {
  code: LlmErrorCode;
  status: number;
  constructor(code: LlmErrorCode, message: string, status = 502) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}
