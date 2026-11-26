// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEagerRoot, NativeField, render } from '@/platform/dom';

let box: HTMLDivElement;
beforeEach(() => {
  box = document.createElement('div');
  document.body.appendChild(box);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  render(null, box);
  box.remove();
  vi.restoreAllMocks();
});

describe('render', () => {
  it('draws at once, so the next line can read the page', () => {
    render(createElement('p', { id: 'a' }, 'hello'), box);
    expect(box.querySelector('#a')?.textContent).toBe('hello');
  });

  it('replaces what it drew before in the same container', () => {
    render(createElement('p', null, 'one'), box);
    render(createElement('p', null, 'two'), box);
    expect(box.textContent).toBe('two');
  });

  it('removes everything when given nothing, and ignores a missing container', () => {
    render(createElement('p', null, 'one'), box);
    render(null, box);
    expect(box.textContent).toBe('');
    expect(() => render(createElement('p'), null)).not.toThrow();
    expect(() => render(null, document.createElement('div'))).not.toThrow();
  });

  it('hands a drawing error to the caller, and works again afterwards', () => {
    const Bomb = (): ReactNode => {
      throw new Error('made-up error');
    };
    expect(() => render(createElement(Bomb), box)).toThrow('made-up error');
    expect(() => render(createElement('p', null, 'fine'), box)).not.toThrow();
    expect(box.textContent).toBe('fine');
  });
});

describe('NativeField', () => {
  it('keeps the value it is given, and runs onChange for the native change event', () => {
    const seen: string[] = [];
    const onChange = (e: Event) => seen.push((e.target as HTMLInputElement).value);
    render(createElement(NativeField, { as: 'input', value: 'abc', onChange }), box);
    const input = box.querySelector('input')!;
    expect(input.value).toBe('abc');
    input.value = 'typed';
    input.dispatchEvent(new Event('change'));
    expect(seen).toEqual(['typed']);
    render(createElement(NativeField, { as: 'input', value: 'next', onChange }), box);
    expect(box.querySelector('input')!.value).toBe('next');
  });

  it('keeps a checkbox in step with its checked prop and fills a ref', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(createElement(NativeField, { as: 'input', type: 'checkbox', checked: true, ref }), box);
    expect(ref.current?.checked).toBe(true);
    render(createElement(NativeField, { as: 'input', type: 'checkbox', checked: false, ref }), box);
    expect(ref.current?.checked).toBe(false);
  });

  it('takes children, for a select', () => {
    render(
      createElement(
        NativeField,
        { as: 'select', value: 'b' },
        createElement('option', { value: 'a' }, 'A'),
        createElement('option', { value: 'b' }, 'B'),
      ),
      box,
    );
    expect(box.querySelector('select')!.value).toBe('b');
  });
});

describe('createEagerRoot', () => {
  it('draws on the next microtask and stops after unmount', async () => {
    const root = createEagerRoot(box);
    root.render(createElement('p', null, 'later'));
    expect(box.textContent).toBe('');
    await Promise.resolve();
    expect(box.textContent).toBe('later');
    root.render(createElement('p', null, 'never'));
    root.unmount();
    await Promise.resolve();
    expect(box.textContent).toBe('');
  });
});
