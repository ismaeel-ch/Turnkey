/**
 * Picks the model provider from environment variables. Server only.
 *
 *   LLM_PROVIDER       optional: litellm | openai | mock. Left unset, the first configured one below is used.
 *   LITELLM_BASE_URL   the SSI gateway address, including /v1          (hackathon names, used as given)
 *   LITELLM_API_KEY    the personal key
 *   LITELLM_MODEL      the model for careful work, e.g. claude-sonnet-5-5
 *   LITELLM_MODEL_FAST optional: the cheap model for the Quick setting, e.g. claude-haiku
 *   OPENAI_API_KEY     an OpenAI key (or any OpenAI-compatible service with OPENAI_BASE_URL)
 *   OPENAI_BASE_URL    optional, defaults to https://api.openai.com/v1
 *   OPENAI_MODEL       required with OPENAI_API_KEY; OPENAI_MODEL_FAST optional
 *
 * Keys are read here and nowhere else, never logged, never sent to the browser, never in a NEXT_PUBLIC_ variable.
 */
import { mockProvider } from './providers/mock';
import { openAiCompatible } from './providers/openai-compatible';
import type { Provider } from './types';

export * from './types';

type Env = Record<string, string | undefined>;
const has = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';

export function resolveProvider(env: Env = process.env): Provider | null {
  const want = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (want === 'mock') return mockProvider();

  if ((want === '' || want === 'litellm') && has(env.LITELLM_API_KEY) && has(env.LITELLM_BASE_URL)) {
    return openAiCompatible({
      id: 'litellm',
      baseUrl: env.LITELLM_BASE_URL,
      apiKey: env.LITELLM_API_KEY.trim(),
      model: has(env.LITELLM_MODEL) ? env.LITELLM_MODEL.trim() : 'claude-sonnet-5-5',
      quickModel: has(env.LITELLM_MODEL_FAST) ? env.LITELLM_MODEL_FAST.trim() : undefined,
    });
  }
  if ((want === '' || want === 'openai') && has(env.OPENAI_API_KEY) && has(env.OPENAI_MODEL)) {
    return openAiCompatible({
      id: 'openai',
      baseUrl: has(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1',
      apiKey: env.OPENAI_API_KEY.trim(),
      model: env.OPENAI_MODEL.trim(),
      quickModel: has(env.OPENAI_MODEL_FAST) ? env.OPENAI_MODEL_FAST.trim() : undefined,
    });
  }
  return null;
}
