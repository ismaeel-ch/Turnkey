// Copies the SQLite engine (sql.js) into public/vendor, where src/platform/sqlite.ts loads it from.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(path.dirname(require.resolve('sql.js/package.json')), 'dist');
const to = path.join(root, 'public', 'vendor');
fs.mkdirSync(to, { recursive: true });
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(from, f), path.join(to, f));
