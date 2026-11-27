/**
 * POST /api/agent/team: runs an app's agent team on the server and streams what happens as server-sent events.
 *
 *   request   a team run (see src/server/graph/team/types.ts): the team, the input text, the tables the agents write,
 *             and on a second request the snapshot from the pause event plus the person's note
 *   response  one AG-UI event per `data:` line, ending with RUN_FINISHED or RUN_ERROR
 */
import { EventEncoder } from '@ag-ui/encoder';
import { z } from 'zod';
import { createTeamAgent } from '@/server/graph/team/agent';
import { parseBody, refuse, refuseCrossSite, refuseVerdict, visitorKey } from '@/server/guard/http';
import { limiter, limitsFrom } from '@/server/guard/limits';
import { LlmError } from '@/server/llm';
import type { BaseEvent } from '@ag-ui/core';
import { withRequestLog } from '@/server/log';
import { meterCalls } from '@/server/llm/usage';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function post(request: Request) {
  const foreign = refuseCrossSite(request);
  if (foreign) return foreign;
  const limits = limitsFrom();
  if (limits.off) return refuse(503, 'not_configured', 'Live builds are switched off on this deployment. Saved builds still run.');
  // The prompts are built here from the team definition, so the prompt policy does not apply; the body is read with a
  // size limit and the run itself validates the team and the input.
  const parsed = await parseBody(request, z.unknown(), limits.maxPromptChars * 4 + 1000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const who = visitorKey(request);
  // the first model call is checked here so a visitor over the limit gets a plain 429 before anything streams
  const first = limiter.take(who, limits);
  if (!first.ok) return refuseVerdict(first);
  let firstCall = true;
  const encoder = new EventEncoder();
  const bytes = new TextEncoder();
  const agent = createTeamAgent({
    beforeModelCall() {
      if (firstCall) {
        firstCall = false;
        return;
      }
      const v = limiter.take(who, limits);
      if (!v.ok) throw new LlmError(v.code === 'off' ? 'not_configured' : v.code, v.message, 429);
    },
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: unknown) => {
        try {
          controller.enqueue(bytes.encode(encoder.encodeSSE({ ...(event as object), timestamp: Date.now() } as BaseEvent)));
        } catch {
          // the client has gone away
        }
      };
      try {
        // every model call of the run is also sent as a CUSTOM `usage` event (model, tokens, cache, cost), as the
        // agents behind /api/copilotkit do, so the browser can show what a team run spent
        await meterCalls(
          (call) => emit({ type: 'CUSTOM', name: 'usage', value: call }),
          () => agent.run(body, { emit }, request.signal),
        );
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
    headers: { 'content-type': encoder.getContentType(), 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' },
  });
}

export const POST = withRequestLog('agent.team', post);
