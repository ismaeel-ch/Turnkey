/**
 * GET /api/health: is the app up, and is a model configured. Costs nothing.
 * GET /api/health?probe=1: also makes one tiny model call, to check the key and the model name end to end.
 * GET /api/health?probe=tools: the spike's check. One tool call through the OpenAI client against LiteLLM, reporting
 *   whether the configured model can call tools, and which models the key can see.
 *
 * Probes spend a little of the model budget, so they go through the same limits as every other model call.
 * Never returns a key, a gateway address or anything else that is secret. Model names are not secret.
 */
import OpenAI from 'openai';
import { litellmConfig } from '@/lib/model';
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

  const probe = new URL(request.url).searchParams.get('probe');
  if (probe === 'tools') {
    const verdict = limiter.take('probe:' + visitorOf(request));
    out.tools = verdict.ok ? await toolProbe() : { ok: false, error: verdict.message };
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

/** Can the configured LiteLLM model make a tool call? From the spike: a plain OpenAI-client call with one tool. */
async function toolProbe() {
  const { baseURL, apiKey, model, missing } = litellmConfig();
  if (missing.length) return { ok: false, missing };
  const client = new OpenAI({ baseURL, apiKey });
  const started = Date.now();
  try {
    let models: string[] = [];
    try {
      models = (await client.models.list()).data.map((m) => m.id);
    } catch {
      // some LiteLLM keys cannot list models
    }
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Add a note node titled Hello to the canvas.' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'add_canvas_node',
            description: 'Add a node to the canvas',
            parameters: {
              type: 'object',
              properties: { kind: { type: 'string', enum: ['note'] }, title: { type: 'string' } },
              required: ['kind', 'title'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    });
    const call = res.choices[0]?.message?.tool_calls?.[0];
    return {
      ok: Boolean(call),
      model,
      toolCalling: call ? 'works' : 'model answered without a tool call',
      toolCall: call && 'function' in call ? call.function : null,
      availableModels: models,
      ms: Date.now() - started,
    };
  } catch {
    // The SDK's message can carry the gateway address, so it is not passed on.
    return { ok: false, model, error: 'the tool-call probe failed; see the server log', ms: Date.now() - started };
  }
}
