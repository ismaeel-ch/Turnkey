import '@/workspace/saved';
import { REC } from '@/workspace/registry';

/**
 * The saved builds of the workspace (`REC` in src/workspace/builds.ts and quests.ts): what the Researcher and
 * Database agents return in Demo mode. Imported from the workspace itself, so tests check the real definitions and
 * not copies of them.
 */
export interface SavedBuild {
  id: string;
  roles: string[];
  entity: string;
  states: string[];
  database: { tables: unknown[]; users: Array<{ name: string; role: string }> };
}

type Rec = {
  research(): { roles: Array<{ id: string }>; process: { entity: string; states: string[] } };
  database(o: object, n: number): SavedBuild['database'];
};

let cache: SavedBuild[] | null = null;

export function savedBuilds(): SavedBuild[] {
  if (cache) return cache;
  const recs = REC as unknown as Record<string, Rec>; // builds.ts is not typed yet (@ts-nocheck)
  cache = Object.keys(recs).map((id) => {
    const r = recs[id].research(),
      d = recs[id].database({}, 2);
    return {
      id,
      roles: r.roles.map((x) => x.id),
      entity: r.process.entity,
      states: r.process.states,
      database: JSON.parse(JSON.stringify(d)),
    };
  });
  return cache;
}
