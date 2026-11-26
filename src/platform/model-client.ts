/**
 * The browser's side of model access.
 *
 * The workspace modules ask the page for two capabilities: `sample` (send a prompt, get JSON text back, streamed) and
 * `downloads` (save a file). `sample` runs the server's step agent (agent `step` at /api/copilotkit, contract in
 * src/shared/agent-contract.ts) over AG-UI: the server drafts with the model, checks the JSON shape for the agent's
 * role, and streams each step back. No key, endpoint or model name is ever present in the browser.
 */
import type { BaseEvent } from '@ag-ui/core';
import { runAgent, type RunAgentOptions } from '@/platform/agui/client';
import { STEP_AGENT_ID, type StepErrorCode, type StepInput, type StepRole } from '@/shared/agent-contract';

/** One step of the server's agent graph as the browser sees it: `draft`, `validate`, `repair` (and `guard`, `finish`). */
export type StepProgress = { name: string; phase: 'start' | 'end'; attempt: number; ok?: boolean; issues?: string[] };

export type SampleOptions = {
  modelTier?: string;
  cache?: boolean;
  signal?: AbortSignal;
  onText?: (progress: { text: string; delta?: string }) => void;
  /** The server's draft, check and repair steps, as they start and end. */
  onStep?: (step: StepProgress) => void;
  /** Every AG-UI event, for the debug drawer. */
  onEvent?: (event: BaseEvent) => void;
  /**
   * Model calls the server may make for this prompt, its own repairs included. Default 1: the workspace's stations
   * already send work back with their own checks, and each station is capped at three attempts in total.
   */
  maxAttempts?: number;
  role?: StepRole;
  /** For tests. */
  fetch?: typeof fetch;
};
export type SampleResult = {
  text: string;
  truncated: boolean;
  /** Model calls the server used. */
  attempts?: number;
  /** What the server's shape check found, when it returned the draft unchecked (see `sample`). */
  issues?: string[];
};
export type Health = { ok: boolean; live: boolean; version?: string; provider?: string };

/** Codes the workspace understands: `not_granted` turns Live off for the session, `rate_limited` asks to wait. */
export class ModelError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

/** Maps a step error code (or an HTTP status from the route's limiter) to the workspace's codes. */
export function codeFor(code: string | undefined, status = 0): string {
  if (code === 'not_configured' || code === 'off' || code === 'unauthorized' || status === 401 || status === 403 || (status === 503 && !code)) return 'not_granted';
  if (code === 'budget') return 'budget';
  if (code === 'rate_limited' || status === 429) return 'rate_limited';
  if (code === 'aborted') return 'aborted';
  return code || 'error';
}

export async function health(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

type StepResultLike = { text: string; truncated?: boolean; attempts?: number };
const isStepResult = (v: unknown): v is StepResultLike =>
  !!v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string';

/** The route refuses a run before it starts with a JSON body and a status; the client reports it as `HTTP <status>: <body>`. */
function refusal(message: string): { status: number; code?: string; message: string } | null {
  const m = /HTTP (\d{3})[^{]*(\{[\s\S]*\})?/.exec(message);
  if (!m) return null;
  let body: { code?: string; message?: string } = {};
  try {
    body = m[2] ? (JSON.parse(m[2]) as typeof body) : {};
  } catch {
    // not JSON: keep the status only
  }
  return { status: Number(m[1]), code: body.code, message: body.message || 'the model service answered ' + m[1] };
}

/**
 * Runs one agent prompt on the server's step agent and returns the checked JSON text.
 *
 * When the server's shape check fails on the last allowed attempt (`invalid_output`, `truncated`), the last draft is
 * returned as it stands, with the issues: the workspace runs its own, fuller checks on it and sends the work back to
 * the agent itself, or repairs it by code on its last attempt. Any other failure throws a `ModelError`.
 */
export async function sample(prompt: string, opts: SampleOptions = {}): Promise<SampleResult> {
  const input: StepInput = {
    prompt,
    tier: opts.modelTier === 'quick' ? 'quick' : 'default',
    maxAttempts: Math.max(1, Math.min(3, Math.floor(opts.maxAttempts ?? 1))),
    ...(opts.role ? { role: opts.role } : {}),
  };
  let draft = '';
  let attempt = 0;
  let issues: string[] = [];
  const failed = new Set<number>();
  let open: string | null = null;
  const callbacks: RunAgentOptions = {
    forwardedProps: input,
    signal: opts.signal,
    fetch: opts.fetch,
    onEvent: opts.onEvent,
    onStepStarted: (name) => {
      if (name === 'draft') attempt++;
      open = name;
      opts.onStep?.({ name, phase: 'start', attempt: Math.max(1, attempt) });
    },
    onStepFinished: (name) => {
      open = null;
      const n = Math.max(1, attempt);
      const bad = name === 'validate' && failed.has(n);
      opts.onStep?.({ name, phase: 'end', attempt: n, ok: !bad, ...(bad ? { issues } : {}) });
    },
    onText: (delta, _id, soFar) => {
      draft = soFar;
      opts.onText?.({ text: soFar, delta });
    },
    onCustom: (name, value) => {
      if (name !== 'issues' || !value || typeof value !== 'object') return;
      const v = value as { attempt?: number; issues?: unknown };
      issues = Array.isArray(v.issues) ? v.issues.map(String) : [];
      failed.add(typeof v.attempt === 'number' ? v.attempt : Math.max(1, attempt));
    },
  };
  const run = await runAgent(STEP_AGENT_ID, callbacks);
  // a run cut short (stopped, or the connection dropped) leaves its step open: close it so nothing spins forever
  if (open) opts.onStep?.({ name: open, phase: 'end', attempt: Math.max(1, attempt), ok: false });
  if (run.ok) {
    if (!isStepResult(run.result)) throw new ModelError('error', 'the step agent finished without an answer');
    return { text: run.result.text, truncated: !!run.result.truncated, attempts: run.result.attempts ?? attempt };
  }
  if (run.aborted) {
    const e = new Error('The run was stopped.');
    e.name = 'AbortError';
    throw e;
  }
  const code = run.error.code as StepErrorCode | string;
  if ((code === 'invalid_output' || code === 'truncated') && draft.trim())
    return { text: draft, truncated: code === 'truncated', attempts: attempt, issues };
  if (code === 'network') {
    const r = refusal(run.error.message);
    if (r) throw new ModelError(codeFor(r.code, r.status), r.message);
    throw new ModelError('network', 'the model service could not be reached');
  }
  throw new ModelError(codeFor(code), run.error.message || 'the model call failed');
}

const MIME: Record<string, string> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  sqlite: 'application/vnd.sqlite3',
  db: 'application/vnd.sqlite3',
};

export async function saveFile({ filename, data }: { filename: string; data: string | Blob | ArrayBuffer | Uint8Array }): Promise<void> {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: MIME[ext] || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/** What the workspace finds at `window.claude`. A page that already has one (the tests supply a stand-in) keeps it. */
export function createHost() {
  let live: Promise<typeof sample | null> | null = null;
  return {
    use(capability: string): Promise<unknown> {
      if (capability === 'sample') {
        // Offer the model only when the server says a provider is configured. If the check itself cannot be made
        // (the page started offline), offer it anyway: calls will say what is wrong when they are made.
        live ??= health().then((h) => (h && !h.live ? null : sample));
        return live;
      }
      if (capability === 'downloads') return Promise.resolve({ save: saveFile });
      return Promise.resolve(null);
    },
  };
}

type Host = ReturnType<typeof createHost>;
let host: Host | null = null;
/** The model host the workspace uses. A stand-in placed on `window.claude` before the page starts (the browser tests do this) wins. */
export function modelHost(): Host {
  const injected = (window as unknown as { claude?: Host }).claude;
  if (injected) return injected;
  host ??= createHost();
  return host;
}
