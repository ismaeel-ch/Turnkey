/**
 * POST /api/agent/step: one agent step (draft, check, repair) as a stream of newline-delimited JSON.
 *
 *   request   StepInput (src/shared/agent-contract.ts): { prompt, tier?, role?, maxAttempts? }
 *   response  one StepEvent per line; the last line is {"type":"result",...} or {"type":"error",...}
 *   refusal   JSON { code, message } with a status, before anything streams
 *
 * This is the plain-HTTP twin of agent `step` in the CopilotKit runtime, kept until the AG-UI route carries it.
 */
import { z } from 'zod';
import { createStepAgent } from '@/server/graph/step';
import { parseBody, refuse, refuseCrossSite, refuseVerdict, visitorKey } from '@/server/guard/http';
import { limiter, limitsFrom } from '@/server/guard/limits';
import { checkPrompt } from '@/server/guard/prompt';
import { resolveProvider } from '@/server/llm';
import { parseStepInput } from '@/shared/agent-contract';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const foreign = refuseCrossSite(request);
  if (foreign) return foreign;
  const provider = resolveProvider();
  if (!provider) return refuse(503, 'not_configured', 'No model is configured on this deployment.');
  const limits = limitsFrom();
  if (limits.off) return refuse(503, 'not_configured', 'Live builds are switched off on this deployment. Saved builds still run.');
  // The body is read with a size limit first (the prompt limit plus room for the other fields), then checked.
  const body = await parseBody(request, z.unknown(), limits.maxPromptChars * 4 + 1000);
  if (!body.ok) return body.response;
  const parsed = parseStepInput(body.data);
  if (!parsed.ok) return refuse(400, 'bad_request', parsed.message);
  if (parsed.input.prompt.length > limits.maxPromptChars) return refuse(413, 'too_large', 'The prompt is too long.');
  // Only Turnkey's own agents may use the model: checked before anything is counted or sent.
  const policy = checkPrompt(parsed.input.prompt);
  if (!policy.ok) return refuse(400, policy.code, policy.message);

  // every model call counts against the visitor's limits; the first is checked here so a refusal is a plain 429
  const who = visitorKey(request);
  const take = () => limiter.take(who, limits);
  const first = take();
  if (!first.ok) return refuseVerdict(first);
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
