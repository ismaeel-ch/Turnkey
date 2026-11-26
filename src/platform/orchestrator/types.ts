/** The workflow as data, and the ports a compiled graph calls. Nothing here knows about the workspace. */

export interface StationDef {
  id: string;
  name: string;
  agent: string;
  /** The owner gave this station to code: one pass, no model, no send-back, no safe default. */
  byRules?: boolean;
  /** The station has a safe default that is tried when the last attempt fails its checks. */
  fallback?: boolean;
  /** The Researcher may ask the owner one question after this station. */
  asks?: boolean;
}

/** A step the owner added (a library reviewer) or an agent of their own. It sits after one station. */
export interface StepDef {
  id: string;
  name: string;
  after: string;
  mode: 'advise' | 'apply';
  custom?: boolean;
}

export interface WorkflowDefinition {
  stations: StationDef[];
  /** 1 to 3 attempts per station. */
  attempts: number;
  /** Station ids the line stops after, until the owner approves. */
  approvals: string[];
  steps: StepDef[];
  /** Start at this station and keep the ones before it. */
  from?: string;
  /** Tester runs: one run and at most (rounds - 1) repair rounds. Default 3. */
  testerRounds?: number;
}

export interface GateResult {
  /** What failed, in words. Empty means the station passed. */
  issues: string[];
  passed: number;
  total: number;
}

export interface Question {
  text: string;
  options: string[];
  recommended?: number;
}

export interface TestRound {
  total: number;
  failed: number;
}

export type EventPayload = Record<string, unknown>;

export interface Ports {
  /** Receives the events the workspace already logs: RUN_STARTED, STEP_STARTED, CUSTOM, and so on. */
  emit(type: string, payload: EventPayload): void;
  /** One attempt of a station. Return `issues` when the answer was not usable; the gate is then skipped. */
  runStation(a: {
    station: StationDef;
    attempt: number;
    max: number;
    feedback: string[] | null;
    byRules: boolean;
  }): Promise<{ issues?: string[] } | void>;
  /** Run the checks on what the station just made. `last` is true on the final attempt. */
  runGate(a: { station: StationDef; attempt: number; max: number; last: boolean }): Promise<GateResult>;
  /** The station's safe default. Only called for stations with `fallback`. */
  fallback?(a: { station: StationDef }): Promise<{ ok: boolean; issues: string[] }>;
  sentBack(a: { station: StationDef; attempt: number; issues: string[] }): Promise<void>;
  /** The station passed: record it, say what it made. */
  stationDone(a: { station: StationDef }): Promise<void>;
  /** Short pause and highlight before the next station. */
  handoff?(a: { station: StationDef }): Promise<void>;
  runStep(a: { step: StepDef; station: string }): Promise<void>;
  /** Steps added after their station had already passed and that have not run yet. */
  lateSteps?(): Promise<StepDef[]>;
  owner: {
    /** The question to ask after this station, or null. Must be safe to call twice. */
    question(station: StationDef): Promise<Question | null>;
    answered(a: { station: StationDef; question: Question; index: number }): Promise<void>;
    decided(a: { station: StationDef; approved: boolean }): Promise<void>;
  };
  /** All stations passed: connections the app's own agents need, status ready, steps set to apply. */
  ready(): Promise<void>;
  tester: {
    write(): Promise<void>;
    run(a: { round: number; max: number }): Promise<TestRound>;
    /** Send failures back. `progress` is false when nothing could be repaired or withdrawn. */
    repair(a: { round: number; failed: number }): Promise<{ progress: boolean }>;
    done(a: { status: 'ok' | 'failed'; rounds: TestRound[] }): Promise<void>;
  };
  wrapUp(a: { qa: 'ok' | 'failed'; retries: number }): Promise<void>;
  /** Polled between nodes. True makes the run stop. */
  stopped?(): boolean;
}

export type RunStatus = 'running' | 'ok' | 'failed' | 'stopped';

export interface RunOptions {
  /** Added to every event as `app`. */
  app?: string;
  runId?: string;
  threadId?: string;
}

export interface RunResult {
  status: 'ok' | 'failed' | 'stopped' | 'waiting';
  reason?: string;
  /** Set when status is waiting: what the owner is asked. */
  ask?: AskRequest;
  retries: number;
  qa?: 'ok' | 'failed';
  rounds: TestRound[];
  /** Names of the graph nodes that ran, in order. */
  trail: string[];
}

export type AskRequest =
  { reason: 'question'; station: string; text: string; options: string[]; recommended?: number } | { reason: 'approval'; station: string };

export class StoppedError extends Error {
  constructor() {
    super('Stopped');
    this.name = 'StoppedError';
  }
}
