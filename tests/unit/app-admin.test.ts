// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { complete, resolveProvider } from '@/server/llm';
import type { AppRecord } from '@/shared/types/workspace';
import { startLine } from './helpers/workspace-line';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

const mock = resolveProvider({ LLM_PROVIDER: 'mock' })!;
const ask = async (prompt: string) => (await complete(mock, { messages: [{ role: 'user', content: prompt }], tier: 'default' })).text;

let admin: typeof import('@/workspace/app-admin');
let set: typeof import('@/workspace/app-settings');
let engine: typeof import('@/workspace/engine');
let release: typeof import('@/workspace/release');
let line: typeof import('@/workspace/line');
let app: AppRecord;

const why = (r: { ok: boolean; why?: string }) => (r.ok ? '' : r.why || '');
const people = () => engine.appUsers(app);

beforeAll(async () => {
  const world = await startLine(ask);
  admin = await import('@/workspace/app-admin');
  set = await import('@/workspace/app-settings');
  engine = await import('@/workspace/engine');
  release = await import('@/workspace/release');
  line = await import('@/workspace/line');
  app = (await world.build('A gym tracks members, class bookings and trainers')) as unknown as AppRecord;
  await new Promise((r) => setTimeout(r, 50));
  expect(app.status).toBe('ready');
}, 60_000);

describe("changing a built app's settings", () => {
  it('a new app has no settings of its own and the same signature as before there were any', () => {
    expect(app.def.settings).toBeUndefined();
    expect(set.adminRoles(app.def)).toHaveLength(1);
  });

  it('formats, first pages and first views are kept in the definition and leave the test results standing', () => {
    const rev = app.rev,
      sig = release.appSig(app);
    app.tests = { total: 3, passed: 3, failed: 0, at: 1, rev };
    expect(admin.setFormats(app, { currency: 'USD', dates: 'iso' }).ok).toBe(true);
    expect(app.def.settings?.formats).toMatchObject({ currency: 'USD', dates: 'iso', numbers: 'comma' });
    expect(app.rev).toBe(rev + 1);
    expect(app.tests.rev).toBe(app.rev);
    expect(release.appSig(app)).not.toBe(sig);
    expect(app.log?.at(-1)?.text).toMatch(/^Settings: /);
    // a value that is not on the list changes nothing
    const before = app.rev;
    expect(admin.setFormats(app, { currency: 'DOGE' }).ok).toBe(true);
    expect(app.def.settings?.formats.currency).toBe('');
    expect(admin.setFormats(app, { currency: '' }).ok).toBe(true);
    expect(app.rev).toBe(before + 1);

    const role = set.roleIds(app.def)[0],
      mine = app.def.screens.filter((s) => s.roles.includes(role));
    expect(mine.length).toBeGreaterThan(1);
    expect(admin.setHome(app, role, mine[1].id).ok).toBe(true);
    expect(set.homeScreen(app.def, role, mine)?.id).toBe(mine[1].id);
    expect(why(admin.setHome(app, role, 'no_such_page'))).toMatch(/cannot open/);
    expect(admin.setHome(app, role, '').ok).toBe(true);
    expect(app.def.settings?.home[role]).toBeUndefined();

    const list = app.def.screens.find((s) => set.viewChoices(app.def, s).length > 1)!,
      other = set.viewChoices(app.def, list).find((v) => v !== list.type)!;
    expect(admin.setFirstView(app, list.id, other).ok).toBe(true);
    expect(set.defaultView(app.def, list)).toBe(other);
    expect(why(admin.setFirstView(app, list.id, 'hologram'))).toMatch(/cannot be shown/);
    expect(admin.setFirstView(app, list.id, list.type).ok).toBe(true);
    expect(app.def.settings?.views[list.id]).toBeUndefined();
  });

  it('renames the app and changes its look', () => {
    expect(why(admin.setAppName(app, '   '))).toBe('The app needs a name.');
    expect(admin.setAppName(app, 'Iron Works Gym').ok).toBe(true);
    expect([app.name, app.def.brief?.name]).toEqual(['Iron Works Gym', 'Iron Works Gym']);
    const acc = engine.ACCENTS.find((a) => a !== app.def.theme.accent)!;
    expect(admin.setLook(app, { accent: acc, nav: 'top', density: 'compact' }).ok).toBe(true);
    expect(app.def.theme).toMatchObject({ accent: acc, nav: 'top', density: 'compact' });
    const rev = app.rev;
    expect(admin.setLook(app, { accent: 'not-a-colour', nav: 'top' }).ok).toBe(true);
    expect(app.rev).toBe(rev);
  });

  it('renames a stage, in the definition and in the approved plan', () => {
    const P = app.def.process!;
    expect(P.states.length).toBeGreaterThan(1);
    const [a, b] = P.states;
    expect(why(admin.renameStage(app, a.id, b.label))).toMatch(/already called/);
    expect(why(admin.renameStage(app, a.id, ''))).toBe('A stage needs a name.');
    expect(admin.renameStage(app, a.id, 'Just in').ok).toBe(true);
    expect(P.states[0]).toMatchObject({ id: a.id, label: 'Just in' });
    expect(why(admin.renameStage(app, 'nope', 'X'))).toBe('There is no such stage.');
  });

  it('adds a person who can sign in, and keeps the definition in step with the database', () => {
    const before = people().length,
      role = set.roleIds(app.def)[0];
    expect(why(admin.addPerson(app, '', role))).toBe('Give the person a name.');
    expect(why(admin.addPerson(app, 'Zoya Malik', 'ghost'))).toMatch(/kind of person/);
    expect(admin.addPerson(app, '  Zoya   Malik ', role).ok).toBe(true);
    const z = people().find((u) => u.name === 'Zoya Malik')!;
    expect(z).toMatchObject({ role, username: 'zoya.malik' });
    expect(people()).toHaveLength(before + 1);
    expect(app.def.users.map((u) => u.name)).toEqual(people().map((u) => u.name));
    expect(engine.apiCall(app, null, 'POST', '/api/login', { username: 'zoya.malik', password: 'demo' }, 'app').status).toBe(200);
    expect(why(admin.addPerson(app, 'zoya malik', role))).toMatch(/already on the list/);
    // the same name gets its own sign-in name
    expect(admin.addPerson(app, 'Zoya Malik Jr', role).ok).toBe(true);
    expect(admin.renamePerson(app, z.id, 'Zoya M. Khan').ok).toBe(true);
    expect(people().find((u) => u.id === z.id)?.name).toBe('Zoya M. Khan');
  });

  it('never leaves a kind of person with nobody, and never removes someone with records', () => {
    const roles = set.roleIds(app.def);
    // move everyone but one out of the first kind of person: each move is allowed until one is left
    const other = roles[1],
      [lone, ...rest] = people().filter((u) => u.role === roles[0]);
    rest.forEach((u) => expect(admin.setPersonRole(app, u.id, other).ok).toBe(true));
    expect(why(admin.setPersonRole(app, lone.id, other))).toMatch(/is the only/);
    expect(why(admin.removePerson(app, lone.id, -1))).toMatch(/is the only/);

    const z = people().find((u) => u.name === 'Zoya Malik Jr')!;
    expect(why(admin.removePerson(app, z.id, z.id))).toMatch(/cannot remove yourself/);
    expect(admin.setPersonRole(app, z.id, other).ok).toBe(true);
    expect(people().find((u) => u.id === z.id)?.role).toBe(other);
    expect(admin.personRecords(app, z.id)).toBe(0);
    expect(admin.removePerson(app, z.id, -1).ok).toBe(true);
    expect(people().some((u) => u.id === z.id)).toBe(false);
    expect(app.def.users.some((u) => u.name === 'Zoya Malik Jr')).toBe(false);

    // someone the demo data names stays
    const busy = people().find((u) => admin.personRecords(app, u.id) > 0 && people().filter((x) => x.role === u.role).length > 1);
    if (busy) expect(why(admin.removePerson(app, busy.id, -1))).toMatch(/stay on the list/);
  });

  it('somebody can always open Settings', () => {
    const roles = set.roleIds(app.def),
      [first] = set.adminRoles(app.def);
    expect(why(admin.setAdmin(app, first, false))).toBe('Somebody has to be able to open Settings.');
    const second = roles.find((r) => r !== first)!;
    expect(admin.setAdmin(app, second, true).ok).toBe(true);
    expect(set.adminRoles(app.def).sort()).toEqual([first, second].sort());
    expect(admin.setAdmin(app, first, false).ok).toBe(true);
    expect(set.adminRoles(app.def)).toEqual([second]);
    expect(set.canOpenSettings(app.def, first)).toBe(false);
  });

  it('refuses every change while the app is being worked on', () => {
    line.RUNS[app.id] = { n: 1 } as never;
    const rev = app.rev;
    expect(admin.settingsBlocked(app)).toMatch(/Wait until the current work/);
    expect(why(admin.setFormats(app, { currency: 'EUR' }))).toMatch(/Wait until/);
    expect(why(admin.addPerson(app, 'Someone New', set.roleIds(app.def)[0]))).toMatch(/Wait until/);
    expect(app.rev).toBe(rev);
    delete line.RUNS[app.id];
    expect(admin.settingsBlocked(app)).toBe('');
  });
});
