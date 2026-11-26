/**
 * Picks the model provider from environment variables. Server only.
 *
 *   LLM_PROVIDER       optional: litellm | openai | anthropic | claude-cli | mock. Left unset, the first configured
 *                      of litellm, openai and anthropic is used (claude-cli and mock are never picked by themselves).
 *   LITELLM_BASE_URL   the SSI gateway address, including /v1          (hackathon names, used as given)
 *   LITELLM_API_KEY    the personal key
 *   LITELLM_MODEL      the model for careful work, e.g. claude-sonnet-5-5
 *   LITELLM_MODEL_FAST optional: the cheap model for the Quick setting, e.g. claude-haiku
 *   LLM_GATEWAY_RPM    optional: requests a minute the gateway allows (default 55, under its 60)
 *   OPENAI_API_KEY     an OpenAI key (or any OpenAI-compatible service with OPENAI_BASE_URL)
 *   OPENAI_BASE_URL    optional, defaults to https://api.openai.com/v1
 *   OPENAI_MODEL       required with OPENAI_API_KEY; OPENAI_MODEL_FAST optional
 *   ANTHROPIC_API_KEY  an Anthropic key; ANTHROPIC_MODEL (default claude-sonnet-5-5), ANTHROPIC_MODEL_FAST,
 *                      ANTHROPIC_BASE_URL optional
 *   CLAUDE_CLI_MODEL   model alias for the Claude Code command (default sonnet); CLAUDE_CLI_MODEL_FAST; refused on Vercel
 *   LLM_TOOL_MODE      auto | native | json: how tool calls reach the model (see tools.ts)
 *
 * Keys are read here and nowhere else, never logged, never sent to the browser, never in a NEXT_PUBLIC_ variable.
 */
import { anthropic } from './providers/anthropic';
import { claudeCli } from './providers/claude-cli';
import { mockProvider } from './providers/mock';
import { openAiCompatible } from './providers/openai-compatible';
import { withTools } from './tools';
import type { Provider } from './types';

export * from './types';
export { complete } from './complete';
export { withTools, toolModeFor, toolModeSetting } from './tools';

type Env = Record<string, string | undefined>;
const has = (v: string | undefined): v is string => typeof v === 'string' && v.trim() !== '';
const opt = (v: string | undefined) => (has(v) ? v.trim() : undefined);

/** The provider named by the environment, with tool calling working whatever the provider supports. Null: none. */
export function resolveProvider(env: Env = process.env): Provider | null {
  if (env !== process.env) return build(env);
  // The server's own environment does not change while it runs, so the provider (and its request pacer and what it
  // learned about tool calling) is built once per distinct setting.
  const key = KEYS.map((k) => env[k] ?? '').join('\u0001');
  if (!cache || cache.key !== key) cache = { key, provider: build(env) };
  return cache.provider;
}

let cache: { key: string; provider: Provider | null } | null = null;
const KEYS = [
  'LLM_PROVIDER',
  'LLM_TOOL_MODE',
  'LLM_GATEWAY_RPM',
  'VERCEL',
  'LITELLM_BASE_URL',
  'LITELLM_API_KEY',
  'LITELLM_MODEL',
  'LITELLM_MODEL_FAST',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_MODEL_FAST',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_MODEL_FAST',
  'CLAUDE_CLI_MODEL',
  'CLAUDE_CLI_MODEL_FAST',
];

function build(env: Env): Provider | null {
  const inner = resolveRaw(env);
  return inner ? withTools(inner, env) : null;
}

function resolveRaw(env: Env): Provider | null {
  const want = (env.LLM_PROVIDER || '').trim().toLowerCase();
  if (want === 'mock') return mockProvider();
  if (want === 'claude-cli' || want === 'claude') {
    if (env.VERCEL) return null;
    return claudeCli({ model: opt(env.CLAUDE_CLI_MODEL) || 'sonnet', quickModel: opt(env.CLAUDE_CLI_MODEL_FAST), env });
  }

  if ((want === '' || want === 'litellm') && has(env.LITELLM_API_KEY) && has(env.LITELLM_BASE_URL)) {
    const rpm = Number(env.LLM_GATEWAY_RPM);
    return openAiCompatible({
      id: 'litellm',
      baseUrl: env.LITELLM_BASE_URL,
      apiKey: env.LITELLM_API_KEY.trim(),
      model: opt(env.LITELLM_MODEL) || 'claude-sonnet-5-5',
      quickModel: opt(env.LITELLM_MODEL_FAST),
      perMinute: Number.isFinite(rpm) && rpm > 0 ? rpm : 55,
    });
  }
  if ((want === '' || want === 'openai') && has(env.OPENAI_API_KEY) && has(env.OPENAI_MODEL)) {
    return openAiCompatible({
      id: 'openai',
      baseUrl: has(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1',
      apiKey: env.OPENAI_API_KEY.trim(),
      model: env.OPENAI_MODEL.trim(),
      quickModel: opt(env.OPENAI_MODEL_FAST),
    });
  }
  if ((want === '' || want === 'anthropic') && has(env.ANTHROPIC_API_KEY)) {
    return anthropic({
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      model: opt(env.ANTHROPIC_MODEL) || 'claude-sonnet-5-5',
      quickModel: opt(env.ANTHROPIC_MODEL_FAST),
      baseUrl: opt(env.ANTHROPIC_BASE_URL),
    });
  }
  return null;
}
