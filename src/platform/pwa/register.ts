import pwa from '@/platform/generated/pwa.json';

const whenLoaded = () =>
  new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

/** Registers /sw.js for this deployment, then tells it which files the page loaded, so they work offline too. */
export async function registerWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  await whenLoaded();
  const reg = await navigator.serviceWorker.register('/sw.js?v=' + pwa.version, { scope: '/', updateViaCache: 'none' });
  const ready = await navigator.serviceWorker.ready;
  const worker = ready.active || reg.active;
  if (!worker) return;
  const urls = performance
    .getEntriesByType('resource')
    .map((e) => {
      try {
        const u = new URL(e.name);
        return u.origin === location.origin ? u.pathname + u.search : '';
      } catch {
        return '';
      }
    })
    .filter((p) => /^\/(_next\/static|vendor)\//.test(p));
  worker.postMessage({ type: 'keep', urls });
}
