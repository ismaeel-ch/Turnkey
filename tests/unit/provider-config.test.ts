import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveProvider } from '@/server/llm';
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

let restore: () => void;
beforeEach(() => {
  restore = setEnv(CLEAR);
});
afterEach(() => restore());

describe('resolveProvider: LiteLLM defaults', () => {
  it('uses the careful model name of the hackathon when none is given', () => {
    const p = resolveProvider({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'test-key' });
    expect(p?.model('default')).toBe('claude-sonnet-5-5');
    expect(p?.model('quick')).toBe('claude-sonnet-5-5');
  });

  it('needs both an address and a key', () => {
    expect(resolveProvider({ LITELLM_BASE_URL: 'gateway.example/v1' })).toBeNull();
    expect(resolveProvider({ LITELLM_API_KEY: 'test-key' })).toBeNull();
  });

  it('treats a blank value as not set', () => {
    expect(resolveProvider({ LITELLM_BASE_URL: '   ', LITELLM_API_KEY: 'test-key' })).toBeNull();
    expect(resolveProvider({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'test-key', LITELLM_MODEL: ' ' })?.model('default')).toBe(
      'claude-sonnet-5-5',
    );
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
});

describe('resolveProvider: choosing one', () => {
  it('uses LITELLM before OPENAI when both are set', () => {
    const p = resolveProvider({
      LITELLM_BASE_URL: 'gateway.example/v1',
      LITELLM_API_KEY: 'test-key',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'model-a',
    });
    expect(p?.id).toBe('litellm');
  });

  it('is forced by LLM_PROVIDER, which also ignores the other keys', () => {
    const env = { LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'test-key', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'm' };
    expect(resolveProvider({ ...env, LLM_PROVIDER: 'openai' })?.id).toBe('openai');
    expect(resolveProvider({ ...env, LLM_PROVIDER: ' LiteLLM ' })?.id).toBe('litellm');
    expect(resolveProvider({ ...env, LLM_PROVIDER: 'anthropic' })).toBeNull();
  });

  it('is null when the forced provider has no key, even with others set', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'litellm', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'm' })).toBeNull();
  });

  it('reads the process environment when no environment is passed', () => {
    restore();
    restore = setEnv({ ...CLEAR, LLM_PROVIDER: 'mock' });
    expect(resolveProvider()?.id).toBe('mock');
  });
});
