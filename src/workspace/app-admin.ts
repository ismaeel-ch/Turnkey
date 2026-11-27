import type { AppFormats, AppSettings, AppUser, SeedUser } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';
import { clone, commit, snake, str } from './core';
import { dbBump, dbExists, qi, sqlRows, sqlRun } from './db';
import { ACCENTS, appUsers, roleName } from './engine';
import { appBusy } from './history';
import { logChange } from './release';
import { TESTS } from './tests';
import { limitsOf, planLimit } from './limits';
import { recalcAll } from './logic';
import { DEFAULT_FORMATS, adminRoles, normSettings, roleIds, settingsOf, viewChoices } from './app-settings';

/* ===== Turnkey · a built app's own settings: the writing side =====
   Everything the Settings page of a built app can change goes through this file. A change is made at once, with no
   agent run: it is a setting, not a new feature. Each one is checked first (the name is not empty, a kind of person
   keeps at least one person, the last person who can open Settings stays), noted for the next release's notes, and
   refused while the builder or the app's own agents are in the middle of work on the app. */

/** A change that was refused says why, in a sentence for the person who asked. */
export type Outcome = { ok: true } | { ok: false; why: string };
const no = (why: string): Outcome => ({ ok: false, why });
const YES: Outcome = { ok: true };

/** Why settings cannot change right now, or '' when they can. */
export function settingsBlocked(app: AppRecord): string {
  if (!app.def || !dbExists(app.id)) return 'Settings open once the app is built.';
  return appBusy(app) ? 'Wait until the current work on ' + app.name + ' has finished.' : '';
}

/**
 * Seals one change: the definition gets a new revision, the change is noted for the next release, and everything is
 * saved and redrawn. `same` says the change does not touch what the tests check (a colour, a date format), so their
 * last results and the reviewers' reviews still stand.
 */
function seal(app: AppRecord, note: string, same: boolean) {
  const rev = app.rev;
  app.rev = rev + 1;
  if (same) {
    const T = TESTS[app.id];
    if (T && T.rev === rev) T.rev = app.rev;
    if (app.tests && app.tests.rev === rev) app.tests.rev = app.rev;
    Object.keys(app.reviews || {}).forEach((k) => {
      if (app.reviews[k].rev === rev) app.reviews[k].rev = app.rev;
    });
  }
  app.updated = Date.now();
  logChange(app, 'Settings: ' + note, 'settings');
  commit();
}
/** Runs one checked change, unless the app is busy. */
function change(app: AppRecord, note: string, same: boolean, run: () => void): Outcome {
  const why = settingsBlocked(app);
  if (why) return no(why);
  run();
  seal(app, note, same);
  return YES;
}
/** The app's settings, ready to be written to: made from the defaults the first time. */
function own(app: AppRecord): AppSettings {
  if (!app.def.settings) app.def.settings = clone(settingsOf(app.def));
  return app.def.settings;
}

/* ---------- general: name and look ---------- */
export function setAppName(app: AppRecord, given: string): Outcome {
  const name = str(given).slice(0, 40);
  if (!name) return no('The app needs a name.');
  if (name === app.name) return YES;
  return change(app, 'the app is now called ' + name, true, () => {
    app.name = name;
    app.renamed = true;
    if (app.def.brief) app.def.brief.name = name;
  });
}
export function setLook(app: AppRecord, patch: { accent?: string; nav?: string; density?: string }): Outcome {
  const th = app.def.theme,
    accent = patch.accent && ACCENTS.includes(patch.accent) && patch.accent !== th.accent ? patch.accent : null,
    nav = patch.nav && ['side', 'top', 'rail'].includes(patch.nav) && patch.nav !== (th.nav || 'side') ? patch.nav : null,
    density =
      patch.density && ['comfortable', 'compact'].includes(patch.density) && patch.density !== (th.density || 'comfortable')
        ? patch.density
        : null;
  if (!accent && !nav && !density) return YES;
  return change(
    app,
    'a new look (' + [accent && 'colour', nav && 'navigation', density && 'rows'].filter(Boolean).join(', ') + ')',
    true,
    () => {
      if (accent) {
        th.accent = accent;
        app.accent = accent;
      }
      if (nav) th.nav = nav;
      if (density) th.density = density;
    },
  );
}

/* ---------- formats, first pages and first views ---------- */
export function setFormats(app: AppRecord, patch: Partial<AppFormats>): Outcome {
  const next = normSettings({ formats: { ...settingsOf(app.def).formats, ...patch } }, app.def).formats;
  if (JSON.stringify(next) === JSON.stringify(settingsOf(app.def).formats)) return YES;
  return change(app, 'numbers, money and dates are written differently', true, () => {
    // a new object each time: the formatters are remembered per object
    own(app).formats = next;
  });
}
export const resetFormats = (app: AppRecord) => setFormats(app, DEFAULT_FORMATS);
/** The page one kind of person lands on. An empty `screen` goes back to their first page. */
export function setHome(app: AppRecord, role: string, screen: string): Outcome {
  const def = app.def,
    scr = def.screens.find((s) => s.id === screen && s.roles.includes(role));
  if (screen && !scr) return no('That kind of person cannot open that page.');
  if ((settingsOf(def).home[role] || '') === (scr ? scr.id : '')) return YES;
  return change(app, roleName(def, role) + ' starts on ' + (scr ? scr.name : 'their first page'), true, () => {
    const home = own(app).home;
    if (scr) home[role] = scr.id;
    else delete home[role];
  });
}
/** The view a list page opens in. The view it was built with clears the choice. */
export function setFirstView(app: AppRecord, screen: string, view: string): Outcome {
  const def = app.def,
    scr = def.screens.find((s) => s.id === screen);
  if (!scr || !viewChoices(def, scr).includes(view)) return no('That page cannot be shown that way.');
  if ((settingsOf(def).views[scr.id] || scr.type) === view) return YES;
  return change(app, scr.name + ' opens as a ' + view, true, () => {
    const views = own(app).views;
    if (view === scr.type) delete views[scr.id];
    else views[scr.id] = view;
  });
}

/* ---------- who may open Settings ---------- */
export function setAdmin(app: AppRecord, role: string, on: boolean): Outcome {
  const def = app.def;
  if (!roleIds(def).includes(role)) return no('There is no such kind of person.');
  const now = adminRoles(def),
    next = on ? [...new Set([...now, role])] : now.filter((r) => r !== role);
  if (next.length === now.length) return YES;
  if (!next.length) return no('Somebody has to be able to open Settings.');
  return change(app, roleName(def, role) + (on ? ' may' : ' may no longer') + ' open Settings', true, () => {
    own(app).admins = next;
  });
}

/* ---------- stages ---------- */
export function renameStage(app: AppRecord, id: string, given: string): Outcome {
  const P = app.def.process,
    s = P && P.states.find((x) => x.id === id),
    name = str(given).slice(0, 30);
  if (!s) return no('There is no such stage.');
  if (!name) return no('A stage needs a name.');
  if (name === s.label) return YES;
  if (P && P.states.some((x) => x !== s && x.label.toLowerCase() === name.toLowerCase()))
    return no('Another stage is already called ' + name + '.');
  return change(app, 'the stage ' + s.label + ' is now called ' + name, true, () => {
    s.label = name;
    // the approved plan says the same, so a later change run does not bring the old name back
    const ps = app.plan?.stages?.stages.find((x) => x.id === id);
    if (ps) ps.label = name;
  });
}

/* ---------- limits in the app's rules ---------- */
/**
 * Changes one number in the app's rules, such as the amount above which an order needs the director. The formulas
 * that share it, the sentences shown beside them and the approved plan all get the new number.
 */
export function setLimit(app: AppRecord, key: string, value: number): Outcome {
  const L = limitsOf(app.def).find((x) => x.key === key),
    c = planLimit(app, key, value);
  if (c.why || !L) return no(c.why || 'That limit is no longer in the app.');
  if (Math.round(value * 100) / 100 === L.value) return YES;
  // the tests move records across these limits, so their last results no longer stand
  return change(
    app,
    'the limit on ' + L.label.toLowerCase() + ' is now ' + value.toLocaleString('en-US') + (L.percent ? '%' : ''),
    false,
    () => {
      c.apply();
      if (c.recalc) {
        recalcAll(app.id, app.def);
        dbBump(app.id);
      }
    },
  );
}

/* ---------- people ---------- */
/** The people of the app as its database holds them, with what a sign-in needs. */
const people = (app: AppRecord) =>
  sqlRows(app.id, 'SELECT id, name, username, password, role FROM "users" ORDER BY id') as unknown as (AppUser & { password: string })[];
/** The definition lists the same people as the database, in the same order, so a copy or a release starts with them. */
function mirror(app: AppRecord) {
  own(app); // from here on the app's signature counts its people, so the change shows as one to release
  app.def.users = people(app).map((u): SeedUser => ({ name: u.name, role: u.role, username: u.username, password: u.password }));
  dbBump(app.id);
}
/** A sign-in name nobody has yet, made from the person's name. */
function freeUsername(app: AppRecord, name: string): string {
  const taken = new Set(appUsers(app).map((u) => u.username.toLowerCase())),
    base = snake(name).replace(/_/g, '.').slice(0, 24) || 'person';
  let u = base,
    n = 2;
  while (taken.has(u)) u = base + n++;
  return u;
}
export function addPerson(app: AppRecord, given: string, role: string): Outcome {
  const name = str(given).replace(/\s+/g, ' ').slice(0, 60);
  if (!name) return no('Give the person a name.');
  if (!roleIds(app.def).includes(role)) return no('Choose what kind of person they are.');
  if (appUsers(app).some((u) => u.name.toLowerCase() === name.toLowerCase())) return no(name + ' is already on the list.');
  if (appUsers(app).length >= 40) return no('An app holds up to 40 people.');
  return change(app, name + ' joined as ' + roleName(app.def, role), false, () => {
    sqlRun(
      app.id,
      'INSERT INTO "users" ("name", "username", "password", "role") VALUES (?, ?, ?, ?)',
      [name, freeUsername(app, name), 'demo', role],
      'settings',
    );
    mirror(app);
  });
}
export function renamePerson(app: AppRecord, id: number, given: string): Outcome {
  const u = appUsers(app).find((x) => x.id === id),
    name = str(given).replace(/\s+/g, ' ').slice(0, 60);
  if (!u) return no('That person is no longer on the list.');
  if (!name) return no('A person needs a name.');
  if (name === u.name) return YES;
  if (appUsers(app).some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return no(name + ' is already on the list.');
  return change(app, u.name + ' is now called ' + name, true, () => {
    sqlRun(app.id, 'UPDATE "users" SET "name" = ? WHERE "id" = ?', [name, id], 'settings');
    mirror(app);
  });
}
/** Why a kind of person cannot lose `u`: they are the only one, and that part of the work would have nobody. */
function lastOfRole(app: AppRecord, u: AppUser): string {
  return appUsers(app).filter((x) => x.role === u.role).length > 1
    ? ''
    : u.name + ' is the only ' + roleName(app.def, u.role).toLowerCase() + '. Add another one first.';
}
export function setPersonRole(app: AppRecord, id: number, role: string): Outcome {
  const u = appUsers(app).find((x) => x.id === id);
  if (!u) return no('That person is no longer on the list.');
  if (!roleIds(app.def).includes(role)) return no('There is no such kind of person.');
  if (u.role === role) return YES;
  const last = lastOfRole(app, u);
  if (last) return no(last);
  return change(app, u.name + ' is now ' + roleName(app.def, role), false, () => {
    sqlRun(app.id, 'UPDATE "users" SET "role" = ? WHERE "id" = ?', [role, id], 'settings');
    mirror(app);
  });
}
/** How many records name this person: the ones they added, the ones they were given, and their history. */
export function personRecords(app: AppRecord, id: number): number {
  let n = 0;
  const count = (sql: string) => Number((sqlRows(app.id, sql, [id])[0] || {}).n) || 0;
  app.def.tables.forEach((t) => {
    const cols = ['created_by'].concat(t.columns.filter((c) => c.type === 'user').map((c) => c.name));
    n += count('SELECT COUNT(*) AS n FROM ' + qi(t.name) + ' WHERE ' + cols.map((c) => qi(c) + ' = ?1').join(' OR '));
  });
  return n + count('SELECT COUNT(*) AS n FROM "activity" WHERE "user_id" = ?1');
}
/** Takes a person off the list. `me` is whoever asks: nobody removes themselves. */
export function removePerson(app: AppRecord, id: number, me: number): Outcome {
  const u = appUsers(app).find((x) => x.id === id);
  if (!u) return no('That person is no longer on the list.');
  if (id === me) return no('You cannot remove yourself. Ask someone else who can open Settings.');
  const last = lastOfRole(app, u);
  if (last) return no(last);
  const n = personRecords(app, id);
  if (n)
    return no(
      u.name +
        ' added or was given ' +
        n +
        ' record' +
        (n === 1 ? '' : 's') +
        ' or changes, so they stay on the list. You can change what kind of person they are.',
    );
  return change(app, u.name + ' was removed', false, () => {
    sqlRun(app.id, 'DELETE FROM "users" WHERE "id" = ?', [id], 'settings');
    mirror(app);
  });
}
