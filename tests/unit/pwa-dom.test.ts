// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { appInstallLinks, setInstallLinks } from '@/platform/pwa/app';

describe('setInstallLinks', () => {
  it('does nothing without a document', () => {
    expect(setInstallLinks(undefined, null)).toBe(false);
  });
  it('points the manifest link at one app and back at Turnkey', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
    const doc = document;
    setInstallLinks(doc, appInstallLinks({ name: 'Cases' }));
    expect(doc.querySelector('link[rel=manifest]')!.getAttribute('href')).toMatch(/^\/a\/manifest\?/);
    expect(doc.querySelector('link[rel=apple-touch-icon]')!.getAttribute('href')).toMatch(/^\/a\/icon\?/);
    setInstallLinks(doc, null);
    expect(doc.querySelector('link[rel=manifest]')!.getAttribute('href')).toBe('/manifest.webmanifest');
    expect(doc.querySelectorAll('link[rel=manifest]').length).toBe(1);
  });
});
