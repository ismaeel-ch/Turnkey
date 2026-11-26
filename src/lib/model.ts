import { toAiSdkModel } from '@/server/llm/ai-sdk';

// One model configuration for the whole app: src/server/llm reads the environment (LLM_PROVIDER, LITELLM_*,
// OPENAI_*, ANTHROPIC_*, the Claude Code command, or the mock) and everything else asks it. Server only.

/** The AI SDK model for CopilotKit's built-in agent. It follows LLM_PROVIDER like every other model call. */
export function litellmModel() {
  return toAiSdkModel('default');
}

export { toAiSdkModel };
