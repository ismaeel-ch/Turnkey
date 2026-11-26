/**
 * The `echo` demo agent. It needs no model, so the whole path (route, runtime, stream, browser client) can be tested
 * end to end. It is registered only when LLM_PROVIDER=mock.
 *
 * forwardedProps.mode: "fail" ends with an error; "slow" waits between steps so a test can abort the run.
 */
import type { Message } from "@ag-ui/core";
import { graphAgent, type AgentSink } from "./graph-agent";

export const ECHO_AGENT_ID = "echo";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

async function echo(sink: AgentSink): Promise<void> {
  const props = (sink.input.forwardedProps ?? {}) as { mode?: string };
  const said = lastUserText(sink.input.messages).slice(0, 2000);

  sink.step("listen");
  sink.state([{ op: "add", path: "/echo", value: { heard: said.length } }]);
  if (props.mode === "slow") await wait(2000, sink.signal);
  if (props.mode === "fail") return sink.fail("echo_failed", "The echo agent was asked to fail.");

  sink.step("reply");
  const id = sink.toolCall("count_words", { text: said });
  const words = said.split(/\s+/).filter(Boolean);
  sink.toolResult(id, { words: words.length });
  for (const word of words.length ? words : ["(nothing)"]) sink.text(word + " ");
  sink.state([{ op: "replace", path: "/echo/heard", value: words.length }]);
  sink.finish({ echo: said, words: words.length });
}

export const createEchoAgent = () => graphAgent(echo, { description: "Repeats what you said. Needs no model." });
