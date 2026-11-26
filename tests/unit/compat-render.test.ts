// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { html } from '@/platform/compat/html';
import { render } from '@/platform/compat/render';

const made: HTMLElement[] = [];
function container(id?: string) {
  const el = document.createElement('div');
  if (id) el.id = id;
  document.body.appendChild(el);
  made.push(el);
  return el;
}
afterEach(() => {
  for (const el of made.splice(0)) {
    render(null, el);
    el.remove();
  }
});

function Boom(): never {
  throw new Error('drawing failed');
}

describe('render', () => {
  it('has drawn the markup by the time the call returns', () => {
    const el = container();
    render(html`<p class="a">hi</p>`, el);
    expect(el.querySelector('p.a')?.textContent).toBe('hi');
  });
  it('draws again into the same container, keeping the elements it can', () => {
    const el = container();
    render(html`<p>one</p>`, el);
    const p = el.querySelector('p');
    render(html`<p>two</p>`, el);
    expect(el.querySelector('p')).toBe(p);
    expect(el.textContent).toBe('two');
  });
  it('clears the container for render(null)', () => {
    const el = container();
    render(html`<p>hi</p>`, el);
    render(null, el);
    expect(el.innerHTML).toBe('');
  });
  it('can draw into a container again after it was cleared', () => {
    const el = container();
    render(html`<p>a</p>`, el);
    render(null, el);
    render(html`<p>b</p>`, el);
    expect(el.textContent).toBe('b');
  });
  it('does nothing for a missing container, and for clearing an empty one', () => {
    expect(() => render(html`<p>x</p>`, null)).not.toThrow();
    expect(() => render(null, container())).not.toThrow();
  });
  it('throws a drawing error at the caller', () => {
    const el = container();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(createElement(Boom), el)).toThrow('drawing failed');
    vi.restoreAllMocks();
  });
  it('lets a container recover after an error', () => {
    const el = container();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(createElement(Boom), el)).toThrow();
    vi.restoreAllMocks();
    render(html`<p>fine</p>`, el);
    expect(el.textContent).toBe('fine');
  });
  it('puts the workspace root behind an error screen, so a failing screen does not blank the page', () => {
    const el = container('root');
    render(html`<p>works</p>`, el);
    expect(el.textContent).toBe('works');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(createElement(Boom), el)).not.toThrow();
    vi.restoreAllMocks();
    expect(el.textContent).toContain('This screen could not be drawn');
    expect(el.textContent).toContain('drawing failed');
  });
  it('draws children that are not text or elements as nothing', () => {
    const el = container();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(html`<p>a${{ not: 'a node' }}${() => 1}b</p>`, el);
    vi.restoreAllMocks();
    expect(el.querySelector('p')?.textContent).toBe('ab');
  });
});
