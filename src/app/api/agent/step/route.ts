/**
 * POST /api/agent/step: one agent step (draft, check, repair) as a stream of newline-delimited JSON.
 *
 *   request   StepInput (src/shared/agent-contract.ts): { prompt, tier?, role?, maxAttempts? }
 *   response  one StepEvent per line; the last line is {"type":"result",...} or {"type":"error",...}
 *   refusal   JSON { code, message } with a status, before anything streams
 *
 * This is the plain-HTTP twin of agent `step` in the CopilotKit runtime, kept until the AG-UI route carries it.
 */
import { createStepAgent } from '@/server/graph/step';
import { limiter, limitsFrom, visitorOf } from '@/server/guard/limits';
import { resolveProvider } from '@/server/llm';
import { parseStepInput } from '@/shared/agent-contract';

export const runtime = 'nodejs';
export const maxDuration = 300;

const refuse = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store', ...headers } });

export async function POST(request: Request) {
  const provider = resolveProvider();
  if (!provider) return refuse(503, 'not_configured', 'No model is configured on this deployment.');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, 'bad_request', 'The request body must be JSON.');
  }
  const limits = limitsFrom();
  const parsed = parseStepInput(body);
  if (!parsed.ok) return refuse(400, 'bad_request', parsed.message);
  if (parsed.input.prompt.length > limits.maxPromptChars) return refuse(413, 'bad_request', 'The prompt is too long.');

  // every model call counts against the visitor's limits; the first is checked here so a refusal is a plain 429
  const who = visitorOf(request);
  const take = () => limiter.take(who, limits);
  const first = take();
  if (!first.ok) {
    const headers = first.retryAfter ? { 'retry-after': String(first.retryAfter) } : undefined;
    return refuse(first.code === 'off' ? 503 : 429, first.code === 'off' ? 'not_configured' : first.code, first.message, headers);
  }
  const agent = createStepAgent({
    provider,
    maxTokens: limits.maxOutputTokens,
    admit: (attempt) => {
      if (attempt === 1) return null;
      const v = take();
      return v.ok ? null : { code: v.code === 'off' ? 'not_configured' : v.code, message: v.message };
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          // the client has gone away
        }
      };
      try {
        await agent.run(parsed.input, { sink: send, signal: request.signal });
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
