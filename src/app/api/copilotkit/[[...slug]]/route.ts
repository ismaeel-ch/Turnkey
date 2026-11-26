import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { limiter, limitsFrom } from "@/server/guard/limits";
import { refuse, refuseVerdict, visitorKey } from "@/server/guard/http";
import { resolveAgents } from "@/server/agui/registry";

export const runtime = "nodejs";
export const maxDuration = 60;

// The registry decides which agents exist; it is read on every request so late-registered agents show up.
const copilotRuntime = new CopilotRuntime({
  agents: async () => await resolveAgents(),
  runner: new InMemoryAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

// Every run spends model budget, so runs go through the same limits as the other model routes.
const guarded = async (request: Request) => {
  if (request.method === "POST") {
    const limits = limitsFrom();
    // A run carries the whole conversation; a very large body is never a real one.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limits.maxPromptChars * 4) return refuse(413, "too_large", "The request is too large.");
    const verdict = limiter.take(visitorKey(request), limits);
    if (!verdict.ok) return refuseVerdict(verdict);
  }
  return handler(request);
};

export const GET = handler;
export const POST = guarded;
export const OPTIONS = handler;
