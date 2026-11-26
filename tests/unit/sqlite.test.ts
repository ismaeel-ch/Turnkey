// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine is a script that puts initSqlJs on the window. Here appending the script tag stands in for loading it.
type Win = { initSqlJs?: unknown };
let appended: HTMLScriptElement[] = [];
async function fresh() {
  vi.resetModules();
  return import('@/platform/sqlite');
}
function loadsWith(outcome: 'load' | 'error') {
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    const s = node as unknown as HTMLScriptElement;
    appended.push(s);
    queueMicrotask(() => (outcome === 'load' ? s.onload?.(new Event('load')) : s.onerror?.(new Event('error'))));
    return node;
  });
}

beforeEach(() => {
  appended = [];
  delete (window as Win).initSqlJs;
});
afterEach(() => vi.restoreAllMocks());

describe('loadSqlite', () => {
  it('loads the engine from /vendor with its version, and gives the wasm the same version', async () => {
    loadsWith('load');
    const init = vi.fn(async (config?: { locateFile?: (f: string) => string }) => ({ wasm: config?.locateFile?.('x.wasm') }));
    (window as Win).initSqlJs = init;
    const { loadSqlite } = await fresh();
    const engine = (await loadSqlite()) as { wasm: string };
    expect(appended[0].src).toMatch(/\/vendor\/sql-wasm\.js\?v=\d/);
    expect(engine.wasm).toMatch(/^\/vendor\/sql-wasm\.wasm\?v=\d/);
  });

  it('loads once however many times it is asked', async () => {
    loadsWith('load');
    (window as Win).initSqlJs = vi.fn(async () => ({}));
    const { loadSqlite } = await fresh();
    const [a, b] = [loadSqlite(), loadSqlite()];
    expect(a).toBe(b);
    await a;
    expect(appended).toHaveLength(1);
  });

  it('says so when the script does not load, and tries again the next time', async () => {
    loadsWith('error');
    const { loadSqlite } = await fresh();
    await expect(loadSqlite()).rejects.toThrow('The SQLite engine did not load.');
    await Promise.resolve();
    vi.restoreAllMocks();
    loadsWith('load');
    (window as Win).initSqlJs = vi.fn(async () => ({ ok: true }));
    await expect(loadSqlite()).resolves.toEqual({ ok: true });
  });

  it('says so when the script loads but does not offer the engine', async () => {
    loadsWith('load');
    const { loadSqlite } = await fresh();
    await expect(loadSqlite()).rejects.toThrow('The SQLite engine did not load.');
  });
});
