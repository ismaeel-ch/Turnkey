import type { ChatRequest, Completion, Provider, ToolCall, Usage } from './types';

/** Runs a request to the end and collects the stream: `{ text, truncated, usage, toolCalls }`. Throws LlmError like stream(). */
export async function complete(provider: Provider, request: ChatRequest): Promise<Completion> {
  let text = '';
  let truncated = false;
  let usage: Usage | undefined;
  const toolCalls: ToolCall[] = [];
  for await (const chunk of provider.stream(request)) {
    if (chunk.type === 'delta') text += chunk.text;
    else if (chunk.type === 'tool_call') toolCalls.push(chunk.call);
    else {
      truncated = chunk.truncated;
      usage = chunk.usage;
    }
  }
  return { text, truncated, usage, toolCalls };
}
