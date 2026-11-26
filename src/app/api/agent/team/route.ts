/**
 * POST /api/agent/team: runs an app's agent team on the server and streams what happens as server-sent events.
 *
 *   request   a team run (see src/server/graph/team/types.ts): the team, the input text, the tables the agents write,
 *             and on a second request the snapshot from the pause event plus the person's note
 *   response  one AG-UI event per `data:` line, ending with RUN_FINISHED or RUN_ERROR
 */
import { EventEncoder } from '@ag-ui/encoder';
import { createTeamAgent } from '@/server/graph/team/agent';
import { limiter, limitsFrom, visitorOf } from '@/server/guard/limits';
import { LlmError } from '@/server/llm';
import type { BaseEvent } from '@ag-ui/core';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: 'bad_request', message: 'The request body must be JSON.' }, { status: 400 });
  }
  const who = visitorOf(request);
  const limits = limitsFrom();
  const encoder = new EventEncoder();
  const bytes = new TextEncoder();
  const agent = createTeamAgent({
    beforeModelCall() {
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
        await agent.run(body, { emit }, request.signal);
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
