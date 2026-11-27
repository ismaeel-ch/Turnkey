#!/usr/bin/env node
/*
  Bundle-size budget for the workspace page, read from the production build in .next (run `npm run build` first).

  Counts the JavaScript the browser fetches before the workspace shows: the framework chunks, the page's own chunks
  and the chunks of the workspace itself (loaded through next/dynamic; at once for a returning visitor, on the first
  tap of a first visit). Code loaded later on first use, such as the
  build orchestrator (LangGraph) and the AG-UI client, is not counted. Sizes are gzip, as served.

  Fails when the total goes over BUDGET_KB. Raise the budget in the same pull request that needs it, and say why.
  Usage: node scripts/check-bundle.mjs [--json]
*/
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 600; // gzip; 495 KB on 27 Nov 2026 after the saved builds and on-demand screens moved out, 559 KB earlier that day (about 1,070 KB before LangGraph, AG-UI and React Flow loaded on first use)
const NEXT = '.next';
const PAGE = join(NEXT, 'server/app/(workspace)');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (!existsSync(join(PAGE, 'page/build-manifest.json'))) {
  console.error('check-bundle: no production build found. Run `npm run build` first.');
  process.exit(1);
}

const files = new Set();
const build = readJson(join(PAGE, 'page/build-manifest.json'));
for (const f of build.rootMainFiles ?? []) files.add(f);
for (const group of Object.values(build.pagesChunkGroupBootstrapParams ?? {})) for (const f of group.otherChunks ?? []) files.add(f);

// The page's own client chunks, from the client reference manifest (a script that sets globalThis.__RSC_MANIFEST).
const sandbox = {};
sandbox.globalThis = sandbox;
runInNewContext(readFileSync(join(PAGE, 'page_client-reference-manifest.js'), 'utf8'), sandbox);
const ref = Object.values(sandbox.__RSC_MANIFEST ?? {})[0] ?? {};
for (const [entry, list] of Object.entries(ref.entryJSFiles ?? {})) {
  if (entry.endsWith('/page') || entry.endsWith('/layout')) for (const f of list) files.add(f);
}

// The workspace, loaded with next/dynamic as soon as the page runs.
const loadable = readJson(join(PAGE, 'page/react-loadable-manifest.json'));
for (const item of Object.values(loadable)) for (const f of item.files ?? []) if (f.endsWith('.js')) files.add(f);

const rows = [...files].map((f) => {
  const body = readFileSync(join(NEXT, f));
  return { file: f, bytes: body.length, gzip: gzipSync(body, { level: 9 }).length };
});
rows.sort((a, b) => b.gzip - a.gzip);
const total = rows.reduce((s, r) => ({ bytes: s.bytes + r.bytes, gzip: s.gzip + r.gzip }), { bytes: 0, gzip: 0 });
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ budgetKb: BUDGET_KB, total, rows }, null, 2));
} else {
  for (const r of rows) console.log(kb(r.gzip).padStart(8), kb(r.bytes).padStart(9), r.file);
  console.log(`JavaScript before the workspace shows: ${kb(total.gzip)} gzip (${kb(total.bytes)} raw). Budget: ${BUDGET_KB} KB gzip.`);
}
if (total.gzip > BUDGET_KB * 1024) {
  console.error(
    `check-bundle: over budget by ${kb(total.gzip - BUDGET_KB * 1024)}. Load the new code on first use, or raise BUDGET_KB with a reason.`,
  );
  process.exit(1);
}
