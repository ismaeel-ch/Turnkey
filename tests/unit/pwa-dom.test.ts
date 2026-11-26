// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { appInstallLinks, holdInstallLinks, setInstallLinks } from '@/platform/pwa/app';

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
  it('changes every manifest link, wherever the page put it', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
    document.body.innerHTML = '<link rel="manifest" href="/manifest.webmanifest">';
    setInstallLinks(document, appInstallLinks({ name: 'Cases' }));
    for (const l of document.querySelectorAll('link[rel=manifest]')) expect(l.getAttribute('href')).toMatch(/^\/a\/manifest\?/);
    document.body.innerHTML = '';
  });
});

describe('holdInstallLinks', () => {
  it('puts the app back when the page renders the Turnkey link and title again, until stopped', async () => {
    document.head.innerHTML = '<title>Turnkey</title><link rel="manifest" href="/manifest.webmanifest">';
    const stop = holdInstallLinks(document, appInstallLinks({ name: 'Cases' }), 'Cases');
    expect(document.title).toBe('Cases');
    const late = document.createElement('link');
    late.rel = 'manifest';
    late.href = '/manifest.webmanifest';
    document.head.appendChild(late);
    document.querySelector('title')!.textContent = 'Turnkey';
    await new Promise((r) => setTimeout(r, 0));
    expect([...document.querySelectorAll('link[rel=manifest]')].every((l) => l.getAttribute('href')!.startsWith('/a/manifest?'))).toBe(
      true,
    );
    expect(document.title).toBe('Cases');
    stop();
    document.title = 'Turnkey';
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe('Turnkey');
  });
  it('does nothing without a document', () => {
    expect(holdInstallLinks(undefined, null)()).toBeUndefined();
  });
});
