/** Small stand-ins for the browser and server pieces the unit tests need. No network: every response is made here. */

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
