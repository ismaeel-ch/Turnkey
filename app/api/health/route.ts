import OpenAI from "openai";
import { litellmConfig } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Spike check: can the configured LiteLLM model make a tool call?
// Returns no secrets, only pass/fail and what the model did.
export async function GET() {
  const { baseURL, apiKey, model, missing } = litellmConfig();
  if (missing.length) return Response.json({ ok: false, missing }, { status: 500 });

  const client = new OpenAI({ baseURL, apiKey });
  const started = Date.now();
  try {
    let models: string[] = [];
    try {
      models = (await client.models.list()).data.map((m) => m.id);
    } catch {
      /* some LiteLLM keys cannot list models */
    }
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Add a note node titled Hello to the canvas." }],
      tools: [
        {
          type: "function",
          function: {
            name: "add_canvas_node",
            description: "Add a node to the canvas",
            parameters: {
              type: "object",
              properties: { kind: { type: "string", enum: ["note"] }, title: { type: "string" } },
              required: ["kind", "title"],
            },
          },
        },
      ],
      tool_choice: "auto",
    });
    const call = res.choices[0]?.message?.tool_calls?.[0];
    return Response.json({
      ok: Boolean(call),
      model,
      toolCalling: call ? "works" : "model answered without a tool call",
      toolCall: call && "function" in call ? call.function : null,
      availableModels: models,
      ms: Date.now() - started,
    });
  } catch (e) {
    return Response.json(
      { ok: false, model, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
