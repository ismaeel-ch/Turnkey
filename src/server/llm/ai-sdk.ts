/**
 * The gateway as a Vercel AI SDK language model, for CopilotKit's built-in agent. The model is picked when it is
 * called, not when it is built, so importing a route never fails for want of a key: with no model configured, a
 * call fails with a plain "not configured" error. Server only.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { resolveProvider } from './index';
import { LlmError, type ChatMessage, type ChatRequest, type Provider, type Tier, type ToolCall, type ToolDef } from './types';

const stringify = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? null));

export function fromAiSdkPrompt(prompt: LanguageModelV3Prompt): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of prompt) {
    if (m.role === 'system') out.push({ role: 'system', content: m.content });
    else if (m.role === 'user') out.push({ role: 'user', content: m.content.map((p) => (p.type === 'text' ? p.text : '')).join('') });
    else if (m.role === 'assistant') {
      let content = '';
      const toolCalls: ToolCall[] = [];
      const results: ChatMessage[] = [];
      for (const p of m.content) {
        if (p.type === 'text') content += p.text;
        else if (p.type === 'tool-call')
          toolCalls.push({ id: p.toolCallId, name: p.toolName, args: typeof p.input === 'string' ? safeParse(p.input) : p.input });
        else if (p.type === 'tool-result') results.push({ role: 'tool', toolCallId: p.toolCallId, content: outputText(p.output) });
      }
      out.push({ role: 'assistant', content, toolCalls: toolCalls.length ? toolCalls : undefined }, ...results);
    } else {
      for (const p of m.content)
        if (p.type === 'tool-result') out.push({ role: 'tool', toolCallId: p.toolCallId, content: outputText(p.output) });
    }
  }
  return out;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function outputText(output: { type: string; value?: unknown }): string {
  return output.type === 'text' || output.type === 'error-text' ? String(output.value ?? '') : stringify(output.value);
}

const usageOf = (input?: number, output?: number): LanguageModelV3Usage => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function requestOf(options: LanguageModelV3CallOptions, tier: Tier): ChatRequest {
  const tools: ToolDef[] = [];
  for (const t of options.tools ?? []) {
    if (t.type === 'function')
      tools.push({ name: t.name, description: t.description || '', parameters: t.inputSchema as Record<string, unknown> });
  }
  const choice = options.toolChoice?.type;
  const messages = fromAiSdkPrompt(options.prompt);
  if (options.responseFormat?.type === 'json')
    messages.unshift({ role: 'system', content: 'Reply with one JSON object and nothing else.' });
  return {
    messages,
    tier,
    maxTokens: options.maxOutputTokens,
    signal: options.abortSignal,
    tools: tools.length ? tools : undefined,
    toolChoice: choice === 'none' ? 'none' : choice === 'required' || choice === 'tool' ? 'required' : tools.length ? 'auto' : undefined,
  };
}

const finish = (truncated: boolean, calls: number): LanguageModelV3FinishReason =>
  calls
    ? { unified: 'tool-calls', raw: 'tool_calls' }
    : truncated
      ? { unified: 'length', raw: 'length' }
      : { unified: 'stop', raw: 'stop' };

/** `provider` is resolved at call time when left out. */
export function toAiSdkModel(tier: Tier = 'default', provider?: () => Provider | null): LanguageModelV3 {
  const pick = provider ?? (() => resolveProvider());
  const need = () => {
    const p = pick();
    if (!p) throw new LlmError('not_configured', 'No model is configured on this deployment.', 503);
    return p;
  };
  return {
    specificationVersion: 'v3',
    provider: 'turnkey-gateway',
    get modelId() {
      return pick()?.model(tier) ?? 'not-configured';
    },
    supportedUrls: {},
    async doGenerate(options) {
      const p = need();
      let text = '';
      let truncated = false;
      let usage: { input?: number; output?: number } | undefined;
      const calls: ToolCall[] = [];
      for await (const c of p.stream(requestOf(options, tier))) {
        if (c.type === 'delta') text += c.text;
        else if (c.type === 'tool_call') calls.push(c.call);
        else {
          truncated = c.truncated;
          usage = c.usage;
        }
      }
      const content: LanguageModelV3Content[] = [];
      if (text) content.push({ type: 'text', text });
      for (const c of calls) content.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: stringify(c.args) });
      return { content, finishReason: finish(truncated, calls.length), usage: usageOf(usage?.input, usage?.output), warnings: [] };
    },
    async doStream(options) {
      const p = need();
      const source = p.stream(requestOf(options, tier))[Symbol.asyncIterator]();
      let textId: string | null = null;
      let calls = 0;
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
        },
        async pull(controller) {
          try {
            const { done, value } = await source.next();
            if (done) {
              controller.close();
              return;
            }
            if (value.type === 'delta') {
              if (!textId) {
                textId = 'text-0';
                controller.enqueue({ type: 'text-start', id: textId });
              }
              controller.enqueue({ type: 'text-delta', id: textId, delta: value.text });
            } else if (value.type === 'tool_call') {
              calls++;
              controller.enqueue({
                type: 'tool-call',
                toolCallId: value.call.id,
                toolName: value.call.name,
                input: stringify(value.call.args),
              });
            } else {
              if (textId) controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({
                type: 'finish',
                usage: usageOf(value.usage?.input, value.usage?.output),
                finishReason: finish(value.truncated, calls),
              });
              controller.close();
            }
          } catch (e) {
            controller.enqueue({ type: 'error', error: e });
            controller.close();
          }
        },
        async cancel() {
          await source.return?.(undefined);
        },
      });
      return { stream };
    },
  };
}
