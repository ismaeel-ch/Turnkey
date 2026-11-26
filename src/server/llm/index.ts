/**
 * Picks the model provider from environment variables. Server only. Never throws on a missing variable.
 *
 *   LLM_PROVIDER       optional: litellm | openai | anthropic | claude-code | mock
 *                      Unset, the first that applies wins: anthropic (ANTHROPIC_API_KEY set), litellm (all three
 *                      LITELLM_* set), openai, then
 *                      in development only: claude-code (when the `claude` command is installed), then mock.
 *                      In production with nothing configured there is no provider and the app says so.
 *   LITELLM_BASE_URL   the SSI gateway address, including /v1          (hackathon names, used as given)
 *   LITELLM_API_KEY    the personal key
 *   LITELLM_MODEL      the model for planning and building roles (default claude-sonnet-5-5)
 *   LITELLM_MODEL_FAST the model for fast and validator roles (default claude-haiku)
 *   LLM_GATEWAY_RPM    optional: requests a minute the gateway allows (default 55, under its 60)
 *   OPENAI_API_KEY     an OpenAI key (or any OpenAI-compatible service with OPENAI_BASE_URL)
 *   OPENAI_BASE_URL    optional, defaults to https://api.openai.com/v1
 *   OPENAI_MODEL       required with OPENAI_API_KEY; OPENAI_MODEL_FAST optional
 *   ANTHROPIC_API_KEY  an Anthropic key; ANTHROPIC_MODEL (default claude-sonnet-5-5), ANTHROPIC_MODEL_FAST (default
 *                      claude-haiku-5-5), ANTHROPIC_BASE_URL optional
 *   CLAUDE_CODE_MODEL  alias for the Claude Code command (default sonnet); CLAUDE_CODE_MODEL_FAST (default haiku).
 *                      Development only: refused when NODE_ENV is production or VERCEL is set
 *   LLM_TOOL_MODE      auto | native | json: how tool calls reach the model (see tools.ts)
 *   LLM_LOG_USAGE      0 turns off the one-line token and cost log per call (see usage.ts)
 *   LLM_BUDGET_USD     the budget shown beside the running cost in /api/health (default 25)
 *
 * Keys are read here and nowhere else, never logged, never sent to the browser, never in a NEXT_PUBLIC_ variable.
 */
import { anthropic } from './providers/anthropic';
import { claudeCode } from './providers/claude-code';
import { mockProvider } from './providers/mock';
import { openAiCompatible } from './providers/openai-compatible';
import { withTools } from './tools';
import { withUsage } from './usage';
import { isDevelopment, onPath } from './local';
import type { Provider } from './types';

export * from './types';
export { complete } from './complete';
export { withTools } from './tools';
export { EFFORT_BY_TIER } from './features';
export { usageTotals } from './usage';

/** A plain name for the backend in use, for /api/health and the settings screen. Not secret. */
export function backendLabel(provider: Pick<Provider, 'id'> | null): string {
  switch (provider?.id) {
    case 'anthropic':
      return 'Claude API (Anthropic key)';
    case 'claude-code':
      return 'Claude Code command (local, your Claude login)';
    case 'litellm':
      return 'SSI LiteLLM gateway';
    case 'openai':
      return 'OpenAI-compatible API';
    case 'mock':
      return 'Stand-in model (no network, no cost)';
    case undefined:
      return 'No model connected';
    default:
      return provider?.id ?? 'unknown';
  }
}

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
  'CLAUDE_CODE_MODEL',
  'CLAUDE_CODE_MODEL_FAST',
  'NODE_ENV',
  'PATH',
];

function build(env: Env): Provider | null {
  const inner = resolveRaw(env);
  // Usage is wrapped first, so the one-off tool probe in withTools is priced and counted too.
  return inner ? withTools(withUsage(inner, env), env) : null;
}

function resolveRaw(env: Env): Provider | null {
  const want = (env.LLM_PROVIDER || '').trim().toLowerCase();
  const auto = want === '';
  if (want === 'mock') return mockProvider();
  if (want === 'claude-code' || want === 'claude-cli') {
    // `claude-cli` is the name the first draft used; accepted so an old .env.local keeps working.
    return isDevelopment(env) ? claudeCode(claudeOptions(env)) : null;
  }

  // A Claude API key comes first: it is the backend for the deployed site until the SSI gateway is used.
  if ((auto || want === 'anthropic') && has(env.ANTHROPIC_API_KEY)) {
    return anthropic({
      apiKey: env.ANTHROPIC_API_KEY.trim(),
      model: opt(env.ANTHROPIC_MODEL) || 'claude-sonnet-5-5',
      quickModel: opt(env.ANTHROPIC_MODEL_FAST) || 'claude-haiku-5-5',
      baseUrl: opt(env.ANTHROPIC_BASE_URL),
    });
  }
  if (
    (auto || want === 'litellm') &&
    has(env.LITELLM_API_KEY) &&
    has(env.LITELLM_BASE_URL) &&
    (want === 'litellm' || has(env.LITELLM_MODEL))
  ) {
    const rpm = Number(env.LLM_GATEWAY_RPM);
    return openAiCompatible({
      id: 'litellm',
      baseUrl: env.LITELLM_BASE_URL,
      apiKey: env.LITELLM_API_KEY.trim(),
      model: opt(env.LITELLM_MODEL) || 'claude-sonnet-5-5',
      quickModel: opt(env.LITELLM_MODEL_FAST) || 'claude-haiku',
      perMinute: Number.isFinite(rpm) && rpm > 0 ? rpm : 55,
    });
  }
  if ((auto || want === 'openai') && has(env.OPENAI_API_KEY) && has(env.OPENAI_MODEL)) {
    return openAiCompatible({
      id: 'openai',
      baseUrl: has(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1',
      apiKey: env.OPENAI_API_KEY.trim(),
      model: env.OPENAI_MODEL.trim(),
      quickModel: opt(env.OPENAI_MODEL_FAST),
    });
  }
  // Nothing configured. On a developer's machine the app still runs: the real model through the Claude Code command
  // if it is installed, the stand-in if not. Never in production: there, "no model" is shown as it is.
  if (auto && isDevelopment(env)) return onPath('claude', env) ? claudeCode(claudeOptions(env)) : mockProvider();
  return null;
}

function claudeOptions(env: Env) {
  return { model: opt(env.CLAUDE_CODE_MODEL) || 'sonnet', quickModel: opt(env.CLAUDE_CODE_MODEL_FAST) || 'haiku', env };
}
