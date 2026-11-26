import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { litellmModel } from "@/lib/model";
import { NODE_KINDS } from "@/lib/canvas";
import { limiter, visitorOf } from "@/server/guard/limits";

export const runtime = "nodejs";
export const maxDuration = 60;

const architect = new BuiltInAgent({
  name: "Architect",
  model: litellmModel(),
  maxSteps: 3,
  temperature: 0.2,
  prompt: [
    "You are the Architect agent in Turnkey, an app builder.",
    "The user describes an app. Put its building blocks on the shared canvas.",
    `Call the add_canvas_node tool once per block. Allowed kinds: ${NODE_KINDS.join(", ")}.`,
    "Add at most 5 nodes per turn. Keep titles under 6 words.",
    "After the tool calls, reply in one short sentence.",
  ].join("\n"),
});

const copilotRuntime = new CopilotRuntime({
  agents: { default: architect },
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
