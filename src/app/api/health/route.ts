/**
 * GET /api/health: is the app up, and is a model configured.
 * GET /api/health?probe=1: also makes one tiny model call, to check the key and the model name end to end.
 *
 * Never returns a key, a gateway address or anything else that is secret. Model names are not secret.
 */
import { limiter, visitorOf } from '@/server/guard/limits';
import { LlmError, resolveProvider } from '@/server/llm';
import pkg from '../../../../package.json';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const provider = resolveProvider();
  const out: Record<string, unknown> = {
    ok: true,
    name: 'turnkey',
    version: pkg.version,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    live: !!provider,
    provider: provider?.id ?? null,
    models: provider ? { default: provider.model('default'), quick: provider.model('quick') } : null,
    usage: limiter.usage(),
    time: new Date().toISOString(),
  };

  if (new URL(request.url).searchParams.get('probe') && provider) {
    const verdict = limiter.take('probe:' + visitorOf(request));
    if (!verdict.ok) out.probe = { ok: false, error: verdict.message };
    else {
      const t0 = Date.now();
      try {
        let text = '';
        for await (const chunk of provider.stream({
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
          tier: 'quick',
          maxTokens: 16,
          temperature: 0,
        })) {
          if (chunk.type === 'delta') text += chunk.text;
        }
        out.probe = { ok: text.trim().length > 0, ms: Date.now() - t0, model: provider.model('quick'), reply: text.trim().slice(0, 40) };
      } catch (e) {
        const error = e instanceof LlmError ? e : new LlmError('upstream', 'the model call failed');
        out.probe = { ok: false, ms: Date.now() - t0, model: provider.model('quick'), code: error.code, error: error.message };
      }
    }
  }
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
}
