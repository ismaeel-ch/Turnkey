/**
 * GET /api/health: is the app up, and is a model configured. Costs nothing.
 * GET /api/health?probe=1: also makes one real tool call through the active provider (on the fast model) and reports
 *   pass or fail, how long it took, and whether tools go natively or by the JSON protocol. `probe=tools` is the same.
 *
 * Probes spend a little of the model budget, so they go through the same limits as every other model call.
 * Never returns a key, a gateway address or anything else that is secret. Model names are not secret.
 */
import { limiter, visitorOf } from '@/server/guard/limits';
import { LlmError, resolveProvider, type Provider } from '@/server/llm';
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

  // ?probe=1 (or ?probe=tools): one real tool-call round trip. Spends a little of the model budget, so it is limited
  // like every other model call.
  if (new URL(request.url).searchParams.get('probe')) {
    const verdict = limiter.take('probe:' + visitorOf(request));
    out.probe = !verdict.ok
      ? { ok: false, error: verdict.message }
      : provider
        ? await toolProbe(provider)
        : { ok: false, error: 'No model is configured on this deployment.' };
  }
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
}

/** Can the configured model make a tool call? One request with one tool, the shape the spike's agent uses. */
async function toolProbe(provider: Provider) {
  const started = Date.now();
  const model = provider.model('quick');
  try {
    let call: { name: string; args: unknown } | null = null;
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'Add a note node titled Hello to the canvas.' }],
      tier: 'quick',
      maxTokens: 200,
      tools: [
        {
          name: 'add_canvas_node',
          description: 'Add a node to the canvas',
          parameters: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['note'] }, title: { type: 'string' } },
            required: ['kind', 'title'],
          },
        },
      ],
      toolChoice: 'auto',
    })) {
      if (chunk.type === 'tool_call' && !call) call = { name: chunk.call.name, args: chunk.call.args };
    }
    const mode = (await provider.toolMode?.('quick')) ?? 'native'; // already known by now: no second call
    return {
      ok: Boolean(call),
      provider: provider.id,
      model,
      mode,
      toolCalling: call ? 'works' : 'model answered without a tool call',
      toolCall: call,
      ms: Date.now() - started,
    };
  } catch (e) {
    // Only the code and the plain message are passed on: they never carry the address or a key.
    const error = e instanceof LlmError ? e : new LlmError('upstream', 'the tool-call probe failed');
    return { ok: false, model, code: error.code, error: error.message, ms: Date.now() - started };
  }
}
