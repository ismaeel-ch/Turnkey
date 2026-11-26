/**
 * Wraps agent `step` (agent-graphs, src/shared/agent-contract.ts) as an AG-UI agent. Written against the contract's
 * shape, not its file, so it works before that file is merged. The event comments in the contract are the mapping:
 *
 *   step_started / step_finished  -> sink.step / sink.endStep   (STEP_STARTED / STEP_FINISHED)
 *   draft_started                 -> nothing (the message opens with its first text)
 *   draft_text                    -> sink.text with messageId `draft-<attempt>` (TEXT_MESSAGE_CONTENT)
 *   draft_ended                   -> sink.endText               (TEXT_MESSAGE_END)
 *   issues                        -> sink.custom("issues", { attempt, issues })
 *   result / run() result         -> sink.finish(result)        (RUN_FINISHED with the result)
 *   error / run() error           -> sink.fail(code, message)   (RUN_ERROR)
 */
import { graphAgent, type AgentSink, type GraphAgent } from "./graph-agent";

type StepLikeEvent =
  | { type: "step_started"; step: string; attempt: number }
  | { type: "step_finished"; step: string; attempt: number }
  | { type: "draft_started"; attempt: number; messageId: string }
  | { type: "draft_text"; attempt: number; messageId: string; text: string }
  | { type: "draft_ended"; attempt: number; messageId: string }
  | { type: "issues"; attempt: number; issues: string[] }
  | { type: "result"; result: unknown }
  | { type: "error"; error: { code: string; message: string } };

export interface StepLikeAgent {
  run(
    input: unknown,
    options?: { sink?: (event: StepLikeEvent) => void; signal?: AbortSignal },
  ): Promise<{ result: unknown } | { error: { code: string; message: string } }>;
}

export function feedStepEvent(sink: AgentSink, event: StepLikeEvent): void {
  switch (event.type) {
    case "step_started":
      sink.step(event.step);
      break;
    case "step_finished":
      sink.endStep();
      break;
    case "draft_text":
      sink.text(event.text, { messageId: event.messageId });
      break;
    case "draft_ended":
      sink.endText();
      break;
    case "issues":
      sink.custom("issues", { attempt: event.attempt, issues: event.issues });
      break;
    // draft_started: the message opens with its first text. result and error are taken from run()'s return value.
  }
}

export function wrapStepAgent(agent: StepLikeAgent): GraphAgent {
  return graphAgent(
    async (sink) => {
      const outcome = await agent.run(sink.input.forwardedProps, {
        sink: (event) => feedStepEvent(sink, event),
        signal: sink.signal,
      });
      if ("error" in outcome) sink.fail(outcome.error.code, outcome.error.message);
      else sink.finish(outcome.result);
    },
    { description: "One Turnkey agent step: draft, check, repair." },
  );
}
