import { compileWorkflow } from './compile';
import { defaultWorkflow } from './default-workflow';
import type { Ports, WorkflowDefinition } from './types';

/** Ports that are never called: enough to compile a graph for drawing. */
const idle = (): Ports => {
  const no = async () => {
    throw new Error('Not for running');
  };
  return {
    emit: () => undefined,
    runStation: no,
    runGate: no,
    fallback: no,
    sentBack: no,
    stationDone: no,
    handoff: no,
    runStep: no,
    lateSteps: no,
    owner: { question: no, answered: no, decided: no },
    ready: no,
    tester: { write: no, run: no, repair: no, done: no },
    wrapUp: no,
  };
};

/** The compiled workflow as Mermaid text. Default: the standard workflow. */
export function diagram(over: Partial<WorkflowDefinition> = {}): string {
  const def = { ...defaultWorkflow(), ...over };
  return compileWorkflow(def, idle()).getGraph().drawMermaid() + '\n';
}
