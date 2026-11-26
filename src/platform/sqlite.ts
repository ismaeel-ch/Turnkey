'use client';
/**
 * Loads the SQLite engine (sql.js, WebAssembly) once. The engine files are copied to /vendor by
 * scripts/copy-sqlite.mjs before `next dev` and `next build`; they are not bundled because sql.js ships a UMD script
 * that expects to be loaded as a classic script.
 */
import { version } from 'sql.js/package.json';

type SqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<unknown>;
let engine: Promise<unknown> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The SQLite engine did not load.'));
    document.head.appendChild(s);
  });
}

export function loadSqlite(): Promise<unknown> {
  engine ??= loadScript(`/vendor/sql-wasm.js?v=${version}`).then(() => {
    const init = (window as unknown as { initSqlJs?: SqlJs }).initSqlJs;
    if (typeof init !== 'function') throw new Error('The SQLite engine did not load.');
    return init({ locateFile: () => `/vendor/sql-wasm.wasm?v=${version}` });
  });
  engine.catch(() => {
    engine = null; // let a later attempt try again
  });
  return engine;
}
