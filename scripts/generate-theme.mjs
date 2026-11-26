// Generates the Fluent 2 theme for the workspace from @fluentui/tokens:
//
//   src/styles/fluent-theme.css    design tokens (light and dark, only the ones used), accent sets, chart colours
//   src/styles/theme.generated.ts  ACC_HEX: the solid accent colours, for places that need them in script (app icons)
//
// Run `npm run theme` after adding a token to src/workspace or src/styles/workspace.css. Both outputs are committed.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = require('@fluentui/tokens');
const L = T.webLightTheme;
const D = T.webDarkTheme;

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'workspace.css'), 'utf8');
const js = walk(path.join(root, 'src', 'workspace'))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

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

const out = path.join(root, 'src', 'styles');
fs.writeFileSync(path.join(out, 'fluent-theme.css'), tokens);
fs.writeFileSync(
  path.join(out, 'theme.generated.ts'),
  '// GENERATED by scripts/generate-theme.mjs from @fluentui/tokens. Do not edit by hand.\n' +
    'export const ACC_HEX: Record<string, [string, string, string]> = ' +
    JSON.stringify(accHex, null, 2) +
    ';\n',
);
console.log('theme: tokens', light.length + ' light, ' + dark.length + ' dark');
if (unknown.length) {
  console.error('UNKNOWN TOKENS: ' + unknown.join(', '));
  process.exitCode = 1;
}
