// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { BootScreen } from '@/platform/boot-screen';
import { bootScreenDone, isBootIntent, setBootIntent, takeBootIntent } from '@/platform/boot-intent';
import { WELCOME_STATIONS, WELCOME_TICKS } from '@/shared/welcome';

describe('the welcome screen the server draws', () => {
  it('names the same stations, in the same order, as the workspace', async () => {
    const { STATIONS } = await import('@/workspace/line');
    expect(WELCOME_STATIONS.map((s) => [s.id, s.name, s.agent])).toEqual(STATIONS.map((s) => [s.id, s.name, s.agent]));
  });

  it('has working buttons for the three ways in, and no real welcome card for tests to mistake it for', () => {
    const html = renderToStaticMarkup(<BootScreen />);
    for (const i of ['sample', 'own', 'start']) expect(html).toContain(`data-boot="${i}"`);
    expect(html).toContain('Try a sample');
    expect(html).toContain('boot-card');
    expect(html).not.toContain('ob-card');
    for (const t of WELCOME_TICKS) expect(html).toContain(t.lead);
    // drawn icons, not empty boxes: every station has its agent's picture
    expect(html.match(/<svg class="ic s16"/g)?.length).toBe(WELCOME_STATIONS.length * 2 - 1 + WELCOME_TICKS.length);
  });
});

describe('a button pressed before the workspace is ready', () => {
  afterEach(() => {
    takeBootIntent();
    document.documentElement.className = '';
  });

  it('is kept until it is read, then forgotten', () => {
    expect(takeBootIntent()).toBeNull();
    setBootIntent('sample');
    setBootIntent('own');
    expect(takeBootIntent()).toBe('own');
    expect(takeBootIntent()).toBeNull();
  });

  it('only counts the three known kinds', () => {
    expect(isBootIntent('start')).toBe(true);
    expect(isBootIntent('reset')).toBe(false);
    expect(isBootIntent(null)).toBe(false);
  });

  it('hides the server screen once the workspace has drawn', () => {
    bootScreenDone();
    expect(document.documentElement.classList.contains('tk-up')).toBe(true);
  });
});
