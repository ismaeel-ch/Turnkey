/** The part of the address that tells one deployment from another: Next.js writes its build id into the page. */
export function deploymentOf(html: string): string {
  const m = /\\?"b\\?":\\?"([A-Za-z0-9_-]{6,40})\\?"/.exec(html);
  if (m)
    return (
      m[1]
        .toLowerCase()
        .replace(/[^0-9a-z]/g, '')
        .slice(0, 32) || 'dev'
    );
  // No build id found: use the names of the script files, which carry a hash of their content.
  const names = [...html.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./%~]+\.js/g)].map((x) => x[0]).sort();
  let h = 5381;
  for (const ch of names.join('|')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

/** The addresses of the files the page loaded that the worker may keep for offline use. */
export function keepableFiles(entries: readonly { name: string }[], origin: string): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    try {
      const u = new URL(e.name);
      const p = u.pathname + u.search;
      if (u.origin === origin && /^\/(_next\/static|vendor)\//.test(p)) out.add(p);
    } catch {
      /* not an address */
    }
  }
  return [...out];
}

const whenLoaded = () =>
  new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

/** Registers /sw.js for this deployment, then tells it which files the page loaded, so they work offline too. */
export async function registerWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  await whenLoaded();
  const html = document.documentElement.outerHTML;
  const reg = await navigator.serviceWorker.register('/sw.js?v=' + deploymentOf(html), { scope: '/', updateViaCache: 'none' });
  const ready = await navigator.serviceWorker.ready;
  const worker = ready.active || reg.active;
  if (!worker) return;
  worker.postMessage({ type: 'keep', urls: keepableFiles(performance.getEntriesByType('resource'), location.origin) });
}

/** In development the worker would serve stale files, so any earlier one is removed. */
export async function removeWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('turnkey-')) await caches.delete(k);
}
