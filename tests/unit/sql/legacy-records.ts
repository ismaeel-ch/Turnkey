import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/**
 * The saved builds of the workspace (`REC` in src/legacy/builds.js and quests.js): what the Researcher and Database
 * agents return in Demo mode. Loaded by running the legacy scripts in a sandbox with stand-in globals, so tests check
 * the real definitions and not copies of them. Read only: nothing in src/legacy is changed.
 */
export interface SavedBuild {
  id: string;
  roles: string[];
  entity: string;
  states: string[];
  database: { tables: unknown[]; users: Array<{ name: string; role: string }> };
}

let cache: SavedBuild[] | null = null;

export function savedBuilds(): SavedBuild[] {
  if (cache) return cache;
  const noop = () => undefined;
  const win = {
    htmPreact: { html: noop, render: noop, useState: noop, useEffect: noop, useLayoutEffect: noop, useRef: noop, useReducer: noop },
  };
  const ctx = vm.createContext({
    window: win,
    document: {},
    navigator: {},
    localStorage: {},
    performance,
    console,
    setTimeout,
    clearTimeout,
    Promise,
  });
  const dir = path.resolve(__dirname, '../../../src/legacy');
  const src = ['core', 'builds', 'quests'].map((f) => fs.readFileSync(path.join(dir, f + '.js'), 'utf8')).join('\n');
  cache = vm.runInContext(
    src +
      `\n;Object.keys(REC).map((id) => { const r = REC[id].research(), d = REC[id].database({}, 2);
        return { id, roles: r.roles.map((x) => x.id), entity: r.process.entity, states: r.process.states, database: JSON.parse(JSON.stringify(d)) }; })`,
    ctx,
  ) as SavedBuild[];
  return cache;
}
