// Prepares what installation and offline need. Runs right after scripts/build-legacy.mjs (it reads assets.json).
//
//   src/platform/generated/pwa-glyphs.json   the app glyphs from src/legacy/icons.js, as data, for the icon route
//   src/platform/generated/pwa.json          { version }: names the service worker and its cache
//   public/vendor/precache.<version>.json    the files the service worker keeps on install
//
// The version changes with every deployment (the commit), and with the stylesheet, the SQLite engine and the
// worker's own code, so a new deployment gets a new worker and a new cache, and the old cache is dropped.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const gen = path.join(root, 'src', 'platform', 'generated');
const vendor = path.join(root, 'public', 'vendor');
const quiet = process.argv.includes('--quiet');

const assetsFile = path.join(gen, 'assets.json');
if (!fs.existsSync(assetsFile)) throw new Error('Run scripts/build-legacy.mjs first: assets.json is missing.');
const assets = JSON.parse(fs.readFileSync(assetsFile, 'utf8'));

const writeIfChanged = (file, text) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// 1. glyphs: icons.js is one line, "const ICONS = {...};"
const iconsSrc = fs.readFileSync(path.join(root, 'src', 'legacy', 'icons.js'), 'utf8');
const m = /const ICONS = (\{.*\});?\s*$/m.exec(iconsSrc);
if (!m) throw new Error('src/legacy/icons.js no longer has the shape "const ICONS = {...}".');
const glyphs = JSON.parse(m[1]);
writeIfChanged(path.join(gen, 'pwa-glyphs.json'), JSON.stringify(glyphs) + '\n');

// 2. the version
let commit = process.env.VERCEL_GIT_COMMIT_SHA || '';
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    commit = String(Date.now());
  }
}
const swSource = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const version = createHash('sha256')
  .update([commit, assets.css, assets.sqlJs, assets.sqlWasm, swSource].join('\n'))
  .digest('hex')
  .slice(0, 12);
writeIfChanged(path.join(gen, 'pwa.json'), JSON.stringify({ version }, null, 2) + '\n');

// 3. the precache list. The Next.js chunks are found by the worker from the page itself, because their names are
// only known after `next build`.
const urls = [
  '/',
  assets.css,
  assets.sqlJs,
  assets.sqlWasm,
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];
fs.mkdirSync(vendor, { recursive: true });
const name = 'precache.' + version + '.json';
writeIfChanged(path.join(vendor, name), JSON.stringify({ version, urls }, null, 2) + '\n');
for (const f of fs.readdirSync(vendor)) if (/^precache\.[0-9a-f]+\.json$/.test(f) && f !== name) fs.rmSync(path.join(vendor, f));
if (!quiet) console.log('build-pwa: version ' + version + ', ' + urls.length + ' files to keep, ' + Object.keys(glyphs).length + ' glyphs');
