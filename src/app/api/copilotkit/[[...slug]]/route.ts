import { CopilotRuntime, createCopilotRuntimeHandler, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { limiter, visitorOf } from "@/server/guard/limits";
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
    const verdict = limiter.take(visitorOf(request));
    if (!verdict.ok) {
      return Response.json({ code: verdict.code, message: verdict.message }, { status: verdict.code === "off" ? 503 : 429 });
    }
  }
  return handler(request);
};

export const GET = handler;
export const POST = guarded;
export const OPTIONS = handler;
