/**
 * GET /api/health: is the app up, and is a model configured. Costs nothing.
 * GET /api/health?probe=1: also makes one tiny model call, to check the key and the model name end to end.
 * GET /api/health?probe=tools: can the configured model call tools? Makes a tool call through the gateway and reports
 *   whether it worked and whether tools go natively or by the JSON protocol.
 *
 * Probes spend a little of the model budget, so they go through the same limits as every other model call.
 * Never returns a key, a gateway address or anything else that is secret. Model names are not secret.
 */
import { limiter, visitorOf } from '@/server/guard/limits';
import { LlmError, resolveProvider, type Provider } from '@/server/llm';
import { forgetToolModes } from '@/server/llm/tools';
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

  const probe = new URL(request.url).searchParams.get('probe');
  if (probe === 'tools') {
    const verdict = limiter.take('probe:' + visitorOf(request));
    out.tools = !verdict.ok
      ? { ok: false, error: verdict.message }
      : provider
        ? await toolProbe(provider)
        : { ok: false, error: 'No model is configured on this deployment.' };
  } else if (probe && provider) {
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

/** Can the configured model make a tool call? One request with one tool, the shape the spike's agent uses. */
async function toolProbe(provider: Provider) {
  const started = Date.now();
  const model = provider.model('default');
  try {
    forgetToolModes(); // a fresh answer, not what an earlier call learned
    const mode = (await provider.toolMode?.('default')) ?? 'native';
    let call: { name: string; args: unknown } | null = null;
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'Add a note node titled Hello to the canvas.' }],
      tier: 'default',
      maxTokens: 200,
      temperature: 0,
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
    return {
      ok: Boolean(call),
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
