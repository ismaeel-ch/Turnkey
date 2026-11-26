/** Small stand-ins for the browser and server pieces the unit tests need. No network: every response is made here. */

/** A Response whose body arrives in the given pieces, so tests can split a line or a character between them. */
export function streamResponse(parts: Array<string | Uint8Array>, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === 'string' ? encoder.encode(part) : part);
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } });
}

/** Sets environment variables for one test. `undefined` removes a variable. Returns the function that puts them back. */
export function setEnv(vars: Record<string, string | undefined>): () => void {
  const before = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(vars)) {
    before.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/** Reads a streamed newline-delimited JSON answer into its events. */
export async function ndjson(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
