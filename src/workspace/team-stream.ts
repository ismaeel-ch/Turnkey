/* Reads the event stream of POST /api/agent/team in the browser.
   The server runs an app's agent team (src/server/graph/team) and sends one AG-UI event per `data:` line. This file
   only turns the bytes into checked events; team.tsx decides what each event means for the app. */

export type TeamStreamEvent = { type: string; [key: string]: unknown };

export class TeamStreamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Splits server-sent events into the JSON objects their `data:` lines carry. Partial input is kept for the next call. */
export class SseParser {
  private buf = '';
  push(chunk: string): TeamStreamEvent[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: TeamStreamEvent[] = [];
    let cut: number;
    while ((cut = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + 2);
      const e = parseBlock(block);
      if (e) out.push(e);
    }
    return out;
  }
  /** what is left when the stream ends without a closing blank line */
  end(): TeamStreamEvent[] {
    const e = parseBlock(this.buf);
    this.buf = '';
    return e ? [e] : [];
  }
}

function parseBlock(block: string): TeamStreamEvent | null {
  const data = block
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data.trim()) return null;
  try {
    const v: unknown = JSON.parse(data);
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { type?: unknown }).type === 'string') return v as TeamStreamEvent;
  } catch {
    // a line that is not JSON is skipped, as AG-UI clients do
  }
  return null;
}

/** Posts a team run and yields its events in order. Throws TeamStreamError when the server refuses the request. */
export async function* streamTeam(body: unknown, signal?: AbortSignal, url = '/api/agent/team'): AsyncGenerator<TeamStreamEvent> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new TeamStreamError('The run was stopped.', 'aborted');
    throw new TeamStreamError('Could not reach the server: ' + String((e as Error)?.message ?? e), 'network');
  }
  if (!res.ok || !res.body) {
    let message = 'The server refused the run (' + res.status + ').';
    let code = 'http_' + res.status;
    try {
      const j = (await res.json()) as { message?: unknown; code?: unknown };
      if (typeof j.message === 'string') message = j.message;
      if (typeof j.code === 'string') code = j.code;
    } catch {
      // the body was not JSON; keep the status line
    }
    throw new TeamStreamError(message, code, res.status);
  }
  const reader = res.body.getReader();
  const text = new TextDecoder();
  const parser = new SseParser();
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const e of parser.push(text.decode(value, { stream: true }))) yield e;
    }
    ended = true;
    for (const e of parser.push(text.decode())) yield e;
    for (const e of parser.end()) yield e;
  } catch (e) {
    if (signal?.aborted) throw new TeamStreamError('The run was stopped.', 'aborted');
    throw e instanceof TeamStreamError ? e : new TeamStreamError('The connection to the server was lost.', 'network');
  } finally {
    // The caller left early (an error event, a step that failed in the browser): close the request too, or the
    // server's team keeps running and spending model calls nobody will read.
    if (!ended) reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/** The connector and tool of a server tool call named `connector.tool`. */
export function splitToolName(name: string): { connector: string; tool: string } {
  const i = name.indexOf('.');
  return i > 0 ? { connector: name.slice(0, i), tool: name.slice(i + 1) } : { connector: name, tool: '' };
}

/** Reads the JSON an event carries as a string (tool arguments, tool results), or returns {} for anything else. */
export function jsonObject(s: unknown): Record<string, unknown> {
  if (typeof s !== 'string') return {};
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
