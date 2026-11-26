// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { appInstallLinks, setInstallLinks } from '@/platform/pwa/app';
import {
  canPromptInstall,
  installHint,
  lastInstalledAt,
  onInstallPrompt,
  promptInstall,
  runningInstalled,
  watchInstallPrompt,
} from '@/platform/pwa/prompt';

/** A stand-in for Chrome's beforeinstallprompt event. */
function offer(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('install prompt', () => {
  watchInstallPrompt(window);
  watchInstallPrompt(window); // a second call adds no second listener

  it('has nothing to offer before the browser makes an offer', async () => {
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
  });

  it('keeps the offer for the Install button and uses it once', async () => {
    const seen = vi.fn();
    const stop = onInstallPrompt(seen);
    const e = offer('accepted');
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(canPromptInstall()).toBe(true);
    expect(seen).toHaveBeenCalled();
    expect(await promptInstall()).toBe('accepted');
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
    stop();
  });

  it('reports a dismissed dialog', async () => {
    window.dispatchEvent(offer('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
  });

  it('ignores an event that is not an offer', () => {
    window.dispatchEvent(new Event('beforeinstallprompt'));
    expect(canPromptInstall()).toBe(false);
  });

  it('drops the offer when the page switches to another app manifest', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
    window.dispatchEvent(offer('accepted'));
    expect(canPromptInstall()).toBe(true);
    setInstallLinks(document, null); // same manifest: the offer stays
    expect(canPromptInstall()).toBe(true);
    setInstallLinks(document, appInstallLinks({ name: 'Cases', key: 'a_1' }));
    expect(canPromptInstall()).toBe(false);
  });

  it('notes when the browser installed the page', () => {
    expect(lastInstalledAt()).toBe(0);
    window.dispatchEvent(new Event('appinstalled'));
    expect(lastInstalledAt()).toBeGreaterThan(0);
  });
});

describe('runningInstalled', () => {
  it('is false in a tab and without a window', () => {
    expect(runningInstalled(undefined)).toBe(false);
    expect(runningInstalled(window)).toBe(false);
  });
  it('is true in an app window', () => {
    const win = { matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }), navigator: {} } as unknown as Window;
    expect(runningInstalled(win)).toBe(true);
  });
});

describe('installHint', () => {
  it('names the right menu for each browser', () => {
    expect(installHint('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari')).toMatch(/Add to Home Screen/);
    expect(installHint('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Version/18 Safari/605')).toMatch(/Add to Dock/);
    expect(installHint('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/130.0')).toMatch(/Firefox/);
    expect(installHint('Mozilla/5.0 (Windows NT 10.0) Chrome/131 Safari/537 Edg/131')).toMatch(/Edge/);
    expect(installHint('Mozilla/5.0 (Linux; Android 14) Chrome/131 Mobile Safari/537')).toMatch(/Add to Home screen/);
    expect(installHint('Mozilla/5.0 (X11; Linux x86_64) Chrome/131 Safari/537')).toMatch(/Install page as app/);
  });
});
