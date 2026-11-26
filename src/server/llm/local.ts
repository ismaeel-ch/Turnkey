/** Where the code is running: used to keep development-only providers off deployments. Server only. */
import fs from 'node:fs';
import path from 'node:path';

type Env = Record<string, string | undefined>;

/** True on a developer's machine or in tests: not production, not Vercel. */
export const isDevelopment = (env: Env): boolean => env.NODE_ENV !== 'production' && !env.VERCEL;

/** Is `command` an executable file in one of the PATH folders? Never throws. */
export function onPath(command: string, env: Env): boolean {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      fs.accessSync(path.join(dir, command), fs.constants.X_OK);
      return true;
    } catch {
      // not here
    }
  }
  return false;
}
