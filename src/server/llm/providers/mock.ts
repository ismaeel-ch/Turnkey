/** A stand-in that needs no key and no network. For tests and for running the app with `LLM_PROVIDER=mock`. */
import type { ChatChunk, ChatRequest, Provider } from '../types';

export function mockProvider(reply?: (request: ChatRequest) => string): Provider {
  return {
    id: 'mock',
    model: (tier) => 'mock-' + tier,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const last = request.messages[request.messages.length - 1]?.content ?? '';
      const text = reply ? reply(request) : JSON.stringify({ mock: true, echo: last.slice(0, 80) });
      const size = Math.max(1, Math.ceil(text.length / 3));
      for (let i = 0; i < text.length; i += size) yield { type: 'delta', text: text.slice(i, i + size) };
      yield { type: 'done', truncated: false, usage: { input: Math.ceil(last.length / 4), output: Math.ceil(text.length / 4) } };
    },
  };
}
