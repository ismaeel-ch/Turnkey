/**
 * A LangChain chat model on the gateway, so LangGraph nodes use the same provider selection, tool handling, retries
 * and limits as everything else. Server only.
 *
 *   const model = toChatModel('default');      // null when no model is configured
 *   const withTools = model.bindTools([...]);  // LangChain tools or JSON-schema tool definitions
 */
import { BaseChatModel, type BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { BaseLanguageModelCallOptions } from '@langchain/core/language_models/base';
import { AIMessage, AIMessageChunk, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { resolveProvider } from './index';
import { LlmError, type ChatMessage, type ChatRequest, type Provider, type Tier, type ToolDef } from './types';

type OpenAiToolDict = { type?: string; function?: { name?: string; description?: string; parameters?: Record<string, unknown> } };

export interface GatewayCallOptions extends BaseLanguageModelCallOptions {
  /** Set by bindTools, in the OpenAI shape. */
  tools?: OpenAiToolDict[];
  tool_choice?: string | Record<string, unknown>;
}

export type GatewayChatModelParams = BaseChatModelParams & { provider: Provider; tier?: Tier; maxTokens?: number };

const textOf = (content: BaseMessage['content']): string =>
  typeof content === 'string'
    ? content
    : content.map((b) => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : '')).join('');

export function toGatewayMessages(messages: BaseMessage[]): ChatMessage[] {
  return messages.map((m): ChatMessage => {
    const type = m._getType();
    const content = textOf(m.content);
    if (type === 'system') return { role: 'system', content };
    if (type === 'tool') return { role: 'tool', content, toolCallId: (m as unknown as { tool_call_id: string }).tool_call_id };
    if (type === 'ai') {
      const calls = (m as AIMessage).tool_calls ?? [];
      return {
        role: 'assistant',
        content,
        toolCalls: calls.length ? calls.map((c, i) => ({ id: c.id || 'call_' + i, name: c.name, args: c.args })) : undefined,
      };
    }
    return { role: 'user', content };
  });
}

function toolsOf(options: GatewayCallOptions): ToolDef[] | undefined {
  const defs = (options.tools ?? [])
    .map((t) => t.function)
    .filter((f): f is NonNullable<OpenAiToolDict['function']> => !!f?.name)
    .map((f) => ({
      name: f.name as string,
      description: f.description || '',
      parameters: f.parameters || { type: 'object', properties: {} },
    }));
  return defs.length ? defs : undefined;
}

const asArgs = (args: unknown): Record<string, unknown> =>
  args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

export class GatewayChatModel extends BaseChatModel<GatewayCallOptions> {
  private provider: Provider;
  private tier: Tier;
  private maxTokens?: number;

  constructor(params: GatewayChatModelParams) {
    super(params);
    this.provider = params.provider;
    this.tier = params.tier ?? 'default';
    this.maxTokens = params.maxTokens;
  }

  _llmType() {
    return 'turnkey-gateway';
  }

  bindTools(tools: Parameters<NonNullable<BaseChatModel['bindTools']>>[0], kwargs?: Partial<GatewayCallOptions>) {
    return this.withConfig({
      ...kwargs,
      tools: tools.map((t) => convertToOpenAITool(t as Parameters<typeof convertToOpenAITool>[0])),
    } as Partial<GatewayCallOptions>);
  }

  private request(messages: BaseMessage[], options: GatewayCallOptions): ChatRequest {
    const choice = options.tool_choice;
    return {
      messages: toGatewayMessages(messages),
      tier: this.tier,
      maxTokens: this.maxTokens,
      signal: options.signal,
      tools: toolsOf(options),
      toolChoice: choice === 'none' ? 'none' : choice === 'any' || choice === 'required' ? 'required' : undefined,
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    let index = 0;
    for await (const chunk of this.provider.stream(this.request(messages, options))) {
      if (chunk.type === 'delta') {
        const out = new ChatGenerationChunk({ message: new AIMessageChunk({ content: chunk.text }), text: chunk.text });
        yield out;
        await runManager?.handleLLMNewToken(chunk.text, undefined, undefined, undefined, undefined, { chunk: out });
      } else if (chunk.type === 'tool_call') {
        yield new ChatGenerationChunk({
          message: new AIMessageChunk({
            content: '',
            tool_call_chunks: [
              {
                type: 'tool_call_chunk',
                id: chunk.call.id,
                name: chunk.call.name,
                args: JSON.stringify(asArgs(chunk.call.args)),
                index: index++,
              },
            ],
          }),
          text: '',
        });
      } else {
        const input = chunk.usage?.input ?? 0;
        const output = chunk.usage?.output ?? 0;
        yield new ChatGenerationChunk({
          message: new AIMessageChunk({
            content: '',
            usage_metadata: { input_tokens: input, output_tokens: output, total_tokens: input + output },
            response_metadata: { finish_reason: chunk.truncated ? 'length' : 'stop' },
          }),
          text: '',
        });
      }
    }
  }

  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    let text = '';
    let truncated = false;
    let usage: { input?: number; output?: number } | undefined;
    const calls: { id: string; name: string; args: Record<string, unknown>; type: 'tool_call' }[] = [];
    for await (const chunk of this.provider.stream(this.request(messages, options))) {
      if (chunk.type === 'delta') {
        text += chunk.text;
        await runManager?.handleLLMNewToken(chunk.text);
      } else if (chunk.type === 'tool_call')
        calls.push({ id: chunk.call.id, name: chunk.call.name, args: asArgs(chunk.call.args), type: 'tool_call' });
      else {
        truncated = chunk.truncated;
        usage = chunk.usage;
      }
    }
    const input = usage?.input ?? 0;
    const output = usage?.output ?? 0;
    const message = new AIMessage({
      content: text,
      tool_calls: calls,
      usage_metadata: { input_tokens: input, output_tokens: output, total_tokens: input + output },
      response_metadata: { finish_reason: truncated ? 'length' : 'stop' },
    });
    return { generations: [{ text, message }], llmOutput: { tokenUsage: { promptTokens: input, completionTokens: output } } };
  }
}

/** A chat model for LangGraph on the configured provider, or null when none is configured. */
export function toChatModel(
  tier: Tier = 'default',
  options: { maxTokens?: number; provider?: Provider | null } = {},
): GatewayChatModel | null {
  const provider = options.provider === undefined ? resolveProvider() : options.provider;
  if (!provider) return null;
  return new GatewayChatModel({ provider, tier, maxTokens: options.maxTokens });
}

/** Like toChatModel, but throws the LlmError the routes already understand when nothing is configured. */
export function requireChatModel(tier: Tier = 'default'): GatewayChatModel {
  const model = toChatModel(tier);
  if (!model) throw new LlmError('not_configured', 'No model is configured on this deployment.', 503);
  return model;
}
