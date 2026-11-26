import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProvider as resolve } from '@/server/llm';
import { setEnv } from './helpers/fakes';

// Every provider variable, cleared before each test, so the machine running the tests cannot change the answer.
const CLEAR = {
  LLM_PROVIDER: undefined,
  LITELLM_BASE_URL: undefined,
  LITELLM_API_KEY: undefined,
  LITELLM_MODEL: undefined,
  LITELLM_MODEL_FAST: undefined,
  OPENAI_API_KEY: undefined,
  OPENAI_BASE_URL: undefined,
  OPENAI_MODEL: undefined,
  OPENAI_MODEL_FAST: undefined,
};

// In production nothing falls back to a stand-in, so "nothing configured" is null.
type Env = Record<string, string | undefined>;
const resolveProvider = (env: Env) => resolve({ NODE_ENV: 'production', PATH: '', ...env });

let restore: () => void;
beforeEach(() => {
  restore = setEnv(CLEAR);
});
afterEach(() => restore());

describe('resolveProvider: LiteLLM defaults', () => {
  it('uses the careful model name of the hackathon when none is given', () => {
    const p = resolveProvider({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'test-key', LITELLM_MODEL: 'claude-sonnet-5-5' });
    expect(p?.id).toBe('litellm');
    expect(p?.model('default')).toBe('claude-sonnet-5-5');
    expect(p?.model('quick')).toBe('claude-haiku');
  });

  it('takes the default model when the provider is named and no model is given', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'litellm', LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'test-key' });
    expect(p?.model('default')).toBe('claude-sonnet-5-5');
  });

  it('needs both an address and a key', () => {
    expect(resolveProvider({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_MODEL: 'm' })).toBeNull();
    expect(resolveProvider({ LITELLM_API_KEY: 'test-key', LITELLM_MODEL: 'm' })).toBeNull();
  });

  it('treats a blank value as not set', () => {
    expect(resolveProvider({ LITELLM_BASE_URL: '   ', LITELLM_API_KEY: 'test-key', LITELLM_MODEL: 'm' })).toBeNull();
    expect(
      resolveProvider({
        LITELLM_BASE_URL: 'gateway.example/v1',
        LITELLM_API_KEY: 'test-key',
        LITELLM_MODEL: ' ',
        LLM_PROVIDER: 'litellm',
      })?.model('default'),
    ).toBe('claude-sonnet-5-5');
  });
});

describe('resolveProvider: OpenAI-compatible services', () => {
  it('goes to OpenAI itself when no address is given', () => {
    const p = resolveProvider({ OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'model-a', OPENAI_MODEL_FAST: 'model-b' });
    expect(p?.id).toBe('openai');
    expect(p?.model('default')).toBe('model-a');
    expect(p?.model('quick')).toBe('model-b');
  });

  it('needs a model name, because there is no sensible default', () => {
    expect(resolveProvider({ OPENAI_API_KEY: 'test-key' })).toBeNull();
  });

  it('shows the model name and reuses it for the quick tier when no fast one is given', () => {
    expect(resolveProvider({ OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'model-a' })?.model('quick')).toBe('model-a');
  });
});

describe('resolveProvider: choosing one', () => {
  it('uses LITELLM before OPENAI when both are set', () => {
    const p = resolveProvider({
      LITELLM_BASE_URL: 'gateway.example/v1',
      LITELLM_API_KEY: 'test-key',
      LITELLM_MODEL: 'model-l',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'model-a',
    });
    expect(p?.id).toBe('litellm');
  });

  it('is forced by LLM_PROVIDER, which also ignores the other keys', () => {
    const env = {
      LITELLM_BASE_URL: 'gateway.example/v1',
      LITELLM_API_KEY: 'test-key',
      LITELLM_MODEL: 'm',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'm',
    };
    expect(resolveProvider({ ...env, LLM_PROVIDER: 'openai' })?.id).toBe('openai');
    expect(resolveProvider({ ...env, LLM_PROVIDER: ' LiteLLM ' })?.id).toBe('litellm');
    expect(resolveProvider({ ...env, LLM_PROVIDER: 'anthropic' })).toBeNull();
    expect(resolveProvider({ ...env, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-key' })?.id).toBe('anthropic');
  });

  it('is null when the forced provider has no key, even with others set', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'litellm', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'm' })).toBeNull();
  });

  it('reads the process environment when no environment is passed', () => {
    restore();
    restore = setEnv({ ...CLEAR, LLM_PROVIDER: 'mock' });
    expect(resolve()?.id).toBe('mock');
  });
});

describe('resolveProvider: Anthropic and the stand-in', () => {
  it('uses the Anthropic key with the hackathon model names', () => {
    const p = resolveProvider({ ANTHROPIC_API_KEY: 'test-key' });
    expect(p?.id).toBe('anthropic');
    expect(p?.model('default')).toBe('claude-sonnet-5-5');
    expect(p?.model('quick')).toBe('claude-haiku-5-5');
  });

  it('is the stand-in when LLM_PROVIDER says mock, and wraps every provider so tools always work', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'mock' });
    expect(p?.id).toBe('mock');
    expect(typeof p?.toolMode).toBe('function');
  });

  it('falls back to the stand-in in development when nothing is set and the Claude Code command is missing', () => {
    expect(resolve({ NODE_ENV: 'development', PATH: '/nonexistent' })?.id).toBe('mock');
  });

  it('never uses the Claude Code command in production or on Vercel', () => {
    expect(resolve({ NODE_ENV: 'production', LLM_PROVIDER: 'claude-code' })).toBeNull();
    expect(resolve({ NODE_ENV: 'development', VERCEL: '1', LLM_PROVIDER: 'claude-cli' })).toBeNull();
    expect(resolve({ NODE_ENV: 'production', VERCEL: undefined, PATH: '/nonexistent' })).toBeNull();
  });
});
