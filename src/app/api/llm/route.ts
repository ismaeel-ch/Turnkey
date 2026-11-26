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
import { z } from 'zod';
import { answerMeter, limiter, limitsFrom } from '@/server/guard/limits';
import { parseBody, refuse, refuseCrossSite, visitorKey } from '@/server/guard/http';
import { checkPrompt } from '@/server/guard/prompt';
import { LlmError, resolveProvider, type Tier } from '@/server/llm';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SYSTEM =
  'You are one of the agents of Turnkey, a tool that builds business apps from a description. ' +
  'Do exactly what the message asks and answer in the format it asks for. Do not add commentary around the answer.';

// The body is read with a size limit first (the prompt limit plus room for the other fields), then checked.
const Body = z.object({ prompt: z.string().min(1, 'A prompt is required.'), tier: z.enum(['default', 'quick']).catch('default') });

export async function POST(request: Request) {
  const foreign = refuseCrossSite(request);
  if (foreign) return foreign;
  const provider = resolveProvider();
  if (!provider) return refuse(503, 'not_configured', 'No model is configured on this deployment.');

  const limits = limitsFrom();
  if (limits.off) return refuse(503, 'not_configured', 'Live builds are switched off on this deployment. Saved builds still run.');

  const parsed = await parseBody(request, Body, limits.maxPromptChars * 4 + 1000);
  if (!parsed.ok) return parsed.response;
  const { prompt, tier } = parsed.data as { prompt: string; tier: Tier };
  if (!prompt.trim()) return refuse(400, 'bad_request', 'A prompt is required.');
  if (prompt.length > limits.maxPromptChars) return refuse(413, 'too_large', 'The prompt is too long.');
  // Only Turnkey's own agents may use the model: checked before anything is counted or sent.
  const policy = checkPrompt(prompt);
  if (!policy.ok) return refuse(400, policy.code, policy.message);

  const verdict = limiter.take(visitorKey(request), limits);
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
          signal: request.signal,
        });
        const meter = answerMeter(limits.maxAnswerChars);
        let cut = false;
        for await (const chunk of chunks) {
          if (chunk.type === 'delta') {
            const part = meter.take(chunk.text);
            if (part.text) send({ type: 'delta', text: part.text });
            if (part.done) {
              cut = true;
              break; // leaving the loop stops the upstream call
            }
          } else if (chunk.type === 'done') {
            send(chunk);
          }
        }
        if (cut) send({ type: 'done', truncated: true });
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
