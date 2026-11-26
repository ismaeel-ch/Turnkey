/**
 * POST /api/llm: one model call for one agent step, streamed back as newline-delimited JSON.
 *
 *   request   { "prompt": string, "tier": "default" | "quick" }
 *   response  {"type":"delta","text":"..."}   any number of times
 *             {"type":"done","truncated":false}
 *             {"type":"error","code":"...","message":"..."}   instead of done, if the call fails midway
 *
 * The key stays on the server. Each agent step is its own short request, so a long build never holds one request
 * open: the browser runs the workflow and asks for one answer at a time.
 */
import { limiter, limitsFrom, visitorOf } from '@/server/guard/limits';
import { LlmError, resolveProvider, type Tier } from '@/server/llm';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SYSTEM =
  'You are one of the agents of Turnkey, a tool that builds business apps from a description. ' +
  'Do exactly what the message asks and answer in the format it asks for. Do not add commentary around the answer.';

const refuse = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function POST(request: Request) {
  const provider = resolveProvider();
  if (!provider) return refuse(503, 'not_configured', 'No model is configured on this deployment.');

  let body: { prompt?: unknown; tier?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return refuse(400, 'bad_request', 'The request body must be JSON.');
  }
  const limits = limitsFrom();
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return refuse(400, 'bad_request', 'A prompt is required.');
  if (prompt.length > limits.maxPromptChars) return refuse(413, 'bad_request', 'The prompt is too long.');
  const tier: Tier = body.tier === 'quick' ? 'quick' : 'default';

  const verdict = limiter.take(visitorOf(request), limits);
  if (!verdict.ok) {
    const headers = verdict.retryAfter ? { 'retry-after': String(verdict.retryAfter) } : undefined;
    return refuse(verdict.code === 'off' ? 503 : 429, verdict.code === 'off' ? 'not_configured' : verdict.code, verdict.message, headers);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      try {
        const chunks = provider.stream({
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt },
          ],
          tier,
          maxTokens: limits.maxOutputTokens,
          temperature: 0.2,
          signal: request.signal,
        });
        for await (const chunk of chunks) send(chunk);
      } catch (e) {
        const error = e instanceof LlmError ? e : new LlmError('upstream', 'the model call failed');
        if (error.code !== 'aborted') console.error('[llm]', provider.id, error.code, error.message);
        try {
          send({ type: 'error', code: error.code === 'unauthorized' ? 'not_configured' : error.code, message: error.message });
        } catch {
          // the client has gone away
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
