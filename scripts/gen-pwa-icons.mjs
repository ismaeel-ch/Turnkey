// Draws Turnkey's own icons from src/platform/pwa/mark.ts: public/icons/*.png, src/app/apple-icon.png,
// src/app/icon.svg and src/app/favicon.ico. Only needed when the mark changes: `npm run icons:pwa`.
// Uses sharp, which Next.js already installs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src/platform/pwa/mark.ts'), 'utf8');
// mark.ts is TypeScript; evaluate the function body as plain JS by stripping its types.
const js = src.replace(/export const/g, 'const').replace(/export function/g, 'function').replace(/ as const;/, ';')
  .replace(/opts: \{[^}]*\} = \{\}/, 'opts = {}').replace(/\): string \{/, ') {');
const { markSvg } = new Function(js + '\nreturn { markSvg };')();
const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
{
  const w = (f, b) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(path.join(root, f), b); };
  w('public/icons/icon-192.png', await png(markSvg(), 192));
  w('public/icons/icon-512.png', await png(markSvg(), 512));
  w('public/icons/maskable-512.png', await png(markSvg({ maskable: true }), 512));
  w('src/app/apple-icon.png', await png(markSvg({ maskable: true }), 180));
  w('src/app/icon.svg', markSvg({ size: 512 }) + '\n');
  // favicon.ico: three PNG images in an ICO container
  const sizes = [16, 32, 48], imgs = await Promise.all(sizes.map((s) => png(markSvg(), s)));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length; const dir = [];
  imgs.forEach((b, i) => { const e = Buffer.alloc(16); e[0] = sizes[i]; e[1] = sizes[i]; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(b.length, 8); e.writeUInt32LE(off, 12); off += b.length; dir.push(e); });
  w('src/app/favicon.ico', Buffer.concat([head, ...dir, ...imgs]));
  console.log('icons written');
}
