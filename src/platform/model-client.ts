/**
 * The browser's side of model access.
 *
 * The workspace modules ask the page for two capabilities: `sample` (send a prompt, get text back, streamed) and
 * `downloads` (save a file). In the prototype the host page supplied them. Here `sample` goes to this app's own
 * server route, which holds the key. No key, endpoint or model name is ever present in the browser.
 */

export type SampleOptions = {
  modelTier?: string;
  cache?: boolean;
  signal?: AbortSignal;
  onText?: (progress: { text: string }) => void;
};
export type SampleResult = { text: string; truncated: boolean };
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

const codeFor = (status: number, code?: string) =>
  code === 'not_configured' || status === 401 || status === 403
    ? 'not_granted'
    : status === 429 && code !== 'budget'
      ? 'rate_limited'
      : code || 'error';

export async function health(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export async function sample(prompt: string, opts: SampleOptions = {}): Promise<SampleResult> {
  let res: Response;
  try {
    res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, tier: opts.modelTier === 'quick' ? 'quick' : 'default' }),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ModelError('network', 'the model service could not be reached');
  }
  if (!res.ok || !res.body) {
    const info = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ModelError(codeFor(res.status, info?.code), info?.message || 'the model service answered ' + res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let truncated = false;
  const take = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { type: string; text?: string; truncated?: boolean; code?: string; message?: string };
    if (event.type === 'delta' && event.text) {
      text += event.text;
      opts.onText?.({ text });
    } else if (event.type === 'done') truncated = !!event.truncated;
    else if (event.type === 'error') throw new ModelError(codeFor(0, event.code), event.message || 'the model call failed');
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
    }
  }
  take(buffer + decoder.decode());
  return { text, truncated };
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
