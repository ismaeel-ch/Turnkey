import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from '@copilotkit/runtime/v2';
import { limiter, limitsFrom } from '@/server/guard/limits';
import { refuse, refuseCrossSite, refuseVerdict, visitorKey } from '@/server/guard/http';
import { resolveAgents } from '@/server/agui/registry';
import { withRequestLog } from '@/server/log';
import { chargeTo } from '@/server/llm/usage';

export const runtime = 'nodejs';
// one Live station can take a few minutes on a careful model; the step agent caps its own attempts
export const maxDuration = 300;

// The registry decides which agents exist; it is read on every request so late-registered agents show up.
const copilotRuntime = new CopilotRuntime({
  agents: async () => await resolveAgents(),
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: '/api/copilotkit',
});

/** Model calls one run of an agent may make, counted up front. The Architect is a tool loop of up to 3 steps. */
const CALLS_PER_RUN: Record<string, number> = { default: 3 };

// Every run spends model budget, so runs go through the same limits as the other model routes.
const guarded = async (request: Request) => {
  if (request.method !== 'POST') return handler(request);
  const foreign = refuseCrossSite(request);
  if (foreign) return foreign;
  const limits = limitsFrom();
  // A run carries the whole conversation; a very large body is never a real one. The header can be left out (a
  // chunked upload), so the body itself is read with the same limit before the runtime sees it.
  const maxBytes = limits.maxPromptChars * 4;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return refuse(413, 'too_large', 'The request is too large.');
  const body = await readCapped(request, maxBytes);
  if (body === null) return refuse(413, 'too_large', 'The request is too large.');
  const agentId = /\/agent\/([^/]+)\/run\/?$/.exec(new URL(request.url).pathname)?.[1];
  const who = visitorKey(request);
  const verdict = limiter.take(who, limits, (agentId && CALLS_PER_RUN[decodeURIComponent(agentId)]) || 1);
  if (!verdict.ok) return refuseVerdict(verdict);
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  // the run's model calls (repairs included) are charged to the visitor, for their share of the daily cap
  return chargeTo(who, () => handler(new Request(request.url, { method: 'POST', headers, body, signal: request.signal })));
};

/** The body as text, or null once it passes `maxBytes`. Stops reading as soon as it is too large. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const GET = handler;
export const POST = withRequestLog('copilotkit', guarded);
export const OPTIONS = handler;
