/** The contract every model provider implements. Server only: nothing here may be imported by browser code. */

/** `default` is the careful model, `quick` the cheap fast one. The workspace sends one or the other. */
export type Tier = 'default' | 'quick';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  tier: Tier;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type Usage = { input?: number; output?: number };

export type ChatChunk = { type: 'delta'; text: string } | { type: 'done'; truncated: boolean; usage?: Usage };

export interface Provider {
  /** `litellm`, `openai`, `anthropic`, `claude-cli` or `mock`. */
  readonly id: string;
  /** The model name used for a tier. Safe to show: it is not a secret. */
  model(tier: Tier): string;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
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
