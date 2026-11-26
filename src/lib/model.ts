import { createOpenAI } from "@ai-sdk/openai";

// All model traffic goes through LiteLLM's OpenAI-compatible endpoint.
// Server-only: these env vars must never be prefixed with NEXT_PUBLIC_.
export function litellmConfig() {
  // The address may be given without a scheme (host/litellm/v1); the gateway is always reached over https.
  const raw = process.env.LITELLM_BASE_URL?.trim().replace(/\/+$/, "");
  const baseURL = raw && !/^https?:\/\//i.test(raw) ? "https://" + raw : raw;
  const apiKey = process.env.LITELLM_API_KEY;
  const model = process.env.LITELLM_MODEL;
  const missing = [
    !baseURL && "LITELLM_BASE_URL",
    !apiKey && "LITELLM_API_KEY",
    !model && "LITELLM_MODEL",
  ].filter(Boolean) as string[];
  return { baseURL: baseURL ?? "", apiKey: apiKey ?? "", model: model ?? "", missing };
}

export function litellmModel() {
  const { baseURL, apiKey, model } = litellmConfig();
  const provider = createOpenAI({ baseURL, apiKey, name: "litellm" });
  // .chat() uses /chat/completions, which every LiteLLM deployment serves.
  return provider.chat(model);
}
