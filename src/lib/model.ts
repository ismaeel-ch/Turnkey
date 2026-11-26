import { toAiSdkModel } from "@/server/llm/ai-sdk";
import { resolveProvider } from "@/server/llm";

// One model configuration for the whole app: src/server/llm reads the environment (LLM_PROVIDER, LITELLM_*,
// OPENAI_*, ANTHROPIC_*, the Claude Code command, or the mock) and everything else asks it. Server only.

/** The AI SDK model for CopilotKit's built-in agent. It follows LLM_PROVIDER like every other model call. */
export function litellmModel() {
  return toAiSdkModel("default");
}

/** Names of the settings the SSI gateway needs and are missing. Empty when it is fully set. Not secret. */
export function litellmConfig() {
  const has = (v: string | undefined) => !!v && v.trim() !== "";
  const missing = [
    !has(process.env.LITELLM_BASE_URL) && "LITELLM_BASE_URL",
    !has(process.env.LITELLM_API_KEY) && "LITELLM_API_KEY",
    !has(process.env.LITELLM_MODEL) && "LITELLM_MODEL",
  ].filter(Boolean) as string[];
  return { missing, provider: resolveProvider()?.id ?? null };
}

export { toAiSdkModel };
