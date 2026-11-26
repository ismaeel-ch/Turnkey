// Builds the workspace UI bundle from src/legacy.
//
// The modules in src/legacy are the prototype's source, kept as they were written: plain scripts that share one
// scope and read their libraries from the page (window.htmPreact, window.initSqlJs, window.React, window.ReactFlow).
// This script concatenates them in ORDER into one ES module that the React app boots, and writes the stylesheet
// (Fluent 2 tokens, React Flow base styles, app.css) and the SQLite engine as static files.
//
//   src/platform/generated/legacy.js    default export bootLegacy(): runs the workspace
//   src/platform/generated/assets.json  the hashed paths of the static files below
//   public/vendor/legacy.<hash>.css     the stylesheet, byte for byte (not run through a CSS pipeline)
//   public/vendor/sql-wasm.js, .wasm    the SQLite engine (sql.js)
//
// Edit src/legacy/*.js or src/legacy/app.css, never the generated files.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const T = require('@fluentui/tokens');
const L = T.webLightTheme;
const D = T.webDarkTheme;

export const ORDER = [
  'icons.js',
  'core.js',
  'db.js',
  'engine.js',
  'viewspec.js',
  'builds.js',
  'quests.js',
  'team.js',
  'room.js',
  'tests.js',
  'flow.js',
  'line.js',
  'changes.js',
  'custom.js',
  'tester.js',
  'ui.js',
  'mobile.js',
  'runtime.js',
  'views-a.js',
  'views-b.js',
  'share.js',
  'release.js',
  'guide.js',
  'shell-a.js',
  'shell-b.js',
  'shell-c.js',
];
const read = (f) => fs.readFileSync(path.join(root, 'src', 'legacy', f), 'utf8');
const present = fs.readdirSync(path.join(root, 'src', 'legacy')).filter((f) => f.endsWith('.js'));
const missing = ORDER.filter((f) => !present.includes(f));
const extra = present.filter((f) => !ORDER.includes(f));
if (missing.length) throw new Error('src/legacy is missing: ' + missing.join(', '));
if (extra.length) throw new Error('src/legacy has modules that are not in ORDER (scripts/build-legacy.mjs): ' + extra.join(', '));

const flowDir = path.dirname(require.resolve('@xyflow/react/package.json'));
const flowVersion = require('@xyflow/react/package.json').version;
const flowCss =
  `/* React Flow base styles: @xyflow/react ${flowVersion}, MIT License, Copyright (c) 2019-2025 webkid GmbH */\n` +
  fs
    .readFileSync(path.join(flowDir, 'dist', 'base.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s*([{};:,>])\s*/g, '$1') +
  '\n';
const css = read('app.css');

/* ---------- icons: only the ones the modules name ---------- */
const rest = ORDER.filter((f) => f !== 'icons.js')
  .map((f) => read(f))
  .join('\n');
const allIcons = JSON.parse(
  read('icons.js')
    .replace(/^[\s\S]*?const ICONS = /, '')
    .replace(/;\s*$/, ''),
);
const keep = {};
Object.keys(allIcons).forEach((k) => {
  if (k === 'circle' || new RegExp('[\'"`]' + k + '[\'"`]').test(rest)) keep[k] = allIcons[k];
});
const iconsJs = '// Fluent System Icons (MIT), 20px, only the ones this page uses\nconst ICONS = ' + JSON.stringify(keep) + ';\n';
const js = ORDER.map((f) => '/* ---- ' + f + ' ---- */\n' + (f === 'icons.js' ? iconsJs : read(f))).join('\n');

/* ---------- tokens: only the ones the page uses ---------- */
const used = new Set();
const re = /var\(--([A-Za-z][A-Za-z0-9]*)/g;
let m;
while ((m = re.exec(css + js))) used.add(m[1]);
const light = [];
const dark = [];
const unknown = [];
[...used].sort().forEach((n) => {
  if (!(n in L)) {
    if (/^(color|shadow|font|border|spacing|duration|curve|stroke|lineHeight)/.test(n)) unknown.push(n);
    return;
  }
  light.push('--' + n + ':' + L[n]);
  if (String(D[n]) !== String(L[n])) dark.push('--' + n + ':' + D[n]);
});

/* ---------- accent sets for agents and built apps, from the Fluent persona palette ---------- */
const hex = (h) => {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const toHex = (c) =>
  '#' +
  c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const mix = (a, b, t) => {
  const x = hex(a),
    y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
const lum = (h) => {
  const c = hex(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const toward = (color, target, bg, min) => {
  let c = color,
    i = 0;
  while (contrast(c, bg) < min && i++ < 40) c = mix(c, target, 0.07);
  return c;
};
const ACC = {
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  cranberry: 'Cranberry',
  forest: 'Forest',
  marigold: 'Marigold',
  pink: 'Pink',
  steel: 'Steel',
  pumpkin: 'Pumpkin',
  lavender: 'Lavender',
  royalBlue: 'RoyalBlue',
  magenta: 'Magenta',
  navy: 'Navy',
  grape: 'Grape',
  seafoam: 'Seafoam',
};
const accLight = [];
const accDark = [];
const report = [];
const accHex = {};
Object.keys(ACC).forEach((k) => {
  const N = 'colorPalette' + ACC[k],
    lineL = L[N + 'BorderActive'],
    lineD = D[N + 'BorderActive'];
  if (!lineL) {
    unknown.push(N + 'BorderActive');
    return;
  }
  const solid = toward(lineL, '#000000', '#ffffff', 4.6),
    tintL = mix(lineL, '#ffffff', 0.88),
    textL = toward(L[N + 'Foreground2'], '#000000', tintL, 4.6),
    markL = contrast(lineL, '#ffffff') >= 3 ? lineL : solid;
  const tintD = mix(lineD, '#292929', 0.78),
    textD = toward(D[N + 'Foreground2'], '#ffffff', tintD, 4.6),
    markD = toward(lineD, '#ffffff', '#292929', 3.1);
  accHex[k] = [solid, mix(solid, '#000000', 0.34), mix(lineL, '#ffffff', 0.3)];
  accLight.push(
    '.acc-' +
      k +
      '{--acc:' +
      solid +
      ';--acc-on:#ffffff;--acc-tint:' +
      tintL +
      ';--acc-text:' +
      textL +
      ';--acc-line:' +
      lineL +
      ';--acc-mark:' +
      markL +
      '}',
  );
  accDark.push(
    '.acc-' +
      k +
      '{--acc:' +
      solid +
      ';--acc-on:#ffffff;--acc-tint:' +
      tintD +
      ';--acc-text:' +
      textD +
      ';--acc-line:' +
      lineD +
      ';--acc-mark:' +
      markD +
      '}',
  );
  report.push(
    k +
      ' solid ' +
      solid +
      ' (' +
      contrast(solid, '#ffffff').toFixed(1) +
      ':1 on white) mark L ' +
      contrast(markL, '#ffffff').toFixed(1) +
      ' D ' +
      contrast(markD, '#292929').toFixed(1),
  );
});
const DARK = [':root[data-app-theme="dark"]', ':root[data-theme="dark"]:not([data-app-theme="light"])'];
const MEDIA = ':root:not([data-theme="light"]):not([data-app-theme="light"])';
let tokens = '/* Fluent 2 design tokens from @fluentui/tokens (webLightTheme, webDarkTheme). Generated: do not edit by hand. */\n';
tokens += ':root{color-scheme:light;' + light.join(';') + '}\n';
tokens += '@media (prefers-color-scheme:dark){' + MEDIA + '{color-scheme:dark;' + dark.join(';') + '}}\n';
DARK.forEach((s) => {
  tokens += s + '{color-scheme:dark;' + dark.join(';') + '}\n';
});
tokens += accLight.join('\n') + '\n';
tokens += '@media (prefers-color-scheme:dark){' + accDark.map((r) => MEDIA + ' ' + r).join('') + '}\n';
DARK.forEach((s) => {
  tokens += accDark.map((r) => s + ' ' + r).join('') + '\n';
});

/* ---------- chart colours: a categorical set checked for both surfaces (white, and #292929 in dark) ---------- */
const CH_L = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const CH_D = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const chartVars = (a) => a.map((c, i) => '--c' + (i + 1) + ':' + c).join(';');
tokens += ':root{' + chartVars(CH_L) + '}\n@media (prefers-color-scheme:dark){' + MEDIA + '{' + chartVars(CH_D) + '}}\n';
DARK.forEach((s) => {
  tokens += s + '{' + chartVars(CH_D) + '}\n';
});

/* ---------- write ---------- */
const boot =
  '#boot{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center}\n';
const sheet = tokens + flowCss + css + '\n' + boot;
const cssName = 'legacy.' + createHash('sha256').update(sheet).digest('hex').slice(0, 10) + '.css';
const gen = path.join(root, 'src', 'platform', 'generated');
const vendor = path.join(root, 'public', 'vendor');
fs.mkdirSync(gen, { recursive: true });
fs.mkdirSync(vendor, { recursive: true });
fs.readdirSync(vendor)
  .filter((f) => /^legacy\.[0-9a-f]+\.css$/.test(f) && f !== cssName)
  .forEach((f) => fs.rmSync(path.join(vendor, f)));

const moduleText =
  '/* eslint-disable */\n// @ts-nocheck\n' +
  '// GENERATED by scripts/build-legacy.mjs from src/legacy/*.js. Do not edit: change the source modules instead.\n' +
  "export default function bootLegacy() {\n'use strict';\n" +
  'const ACC_HEX = ' +
  JSON.stringify(accHex) +
  ';\n' +
  js +
  '\n}\n';
const writeIfChanged = (file, text) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.writeFileSync(file, text);
  return true;
};
writeIfChanged(path.join(gen, 'legacy.js'), moduleText);
writeIfChanged(path.join(vendor, cssName), sheet);

const sqlDir = path.join(path.dirname(require.resolve('sql.js/package.json')), 'dist');
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(sqlDir, f), path.join(vendor, f));
const sqlVersion = require('sql.js/package.json').version;
writeIfChanged(
  path.join(gen, 'assets.json'),
  JSON.stringify(
    { css: '/vendor/' + cssName, sqlJs: '/vendor/sql-wasm.js?v=' + sqlVersion, sqlWasm: '/vendor/sql-wasm.wasm?v=' + sqlVersion },
    null,
    2,
  ) + '\n',
);

if (!quiet) {
  console.log(
    'legacy bundle: js',
    (js.length / 1024).toFixed(0) + ' KB · css',
    (sheet.length / 1024).toFixed(0) + ' KB · tokens',
    light.length + ' light, ' + dark.length + ' dark · icons',
    Object.keys(keep).length + ' of ' + Object.keys(allIcons).length,
  );
  if (process.argv.includes('--report')) console.log(report.join('\n'));
}
if (unknown.length) {
  console.error('UNKNOWN TOKENS: ' + unknown.join(', '));
  process.exitCode = 1;
}
