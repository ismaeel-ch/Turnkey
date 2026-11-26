// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { html } from '@/platform/compat/html';
import { render } from '@/platform/compat/render';

let box: HTMLElement;
function mount(view: unknown) {
  if (!box) {
    box = document.createElement('div');
    document.body.appendChild(box);
  }
  render(view, box);
  return box;
}
afterEach(() => {
  if (box) render(null, box);
  box?.remove();
  box = undefined as unknown as HTMLElement;
});
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('CompatField: values', () => {
  it('writes the value prop to the field', () => {
    const root = mount(html`<input value="abc" />`);
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('abc');
  });
  it('treats null and undefined as an empty field', () => {
    const root = mount(html`<input value=${null} />`);
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('');
  });
  it('writes a new value when the prop changes', () => {
    mount(html`<input value="a" />`);
    const root = mount(html`<input value="b" />`);
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('b');
  });
  it('puts the prop back when a render finds the field different, and accepts what the user typed once the prop matches', () => {
    const root = mount(html`<input value="a" />`);
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'typed';
    mount(html`<input value="a" />`);
    expect(input.value).toBe('a'); // the prop differs from the DOM, so the prop wins, as in Preact
    mount(html`<input value="typed" />`);
    expect(input.value).toBe('typed');
  });
  it('does not rewrite a field that already matches, so the caret stays', () => {
    const root = mount(html`<input value="hello" />`);
    const input = root.querySelector('input') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 2);
    mount(html`<input value="hello" />`);
    expect(input.selectionStart).toBe(2);
  });
  it('keeps the same element across renders', () => {
    const root = mount(html`<textarea value="a"></textarea>`);
    const first = root.querySelector('textarea');
    mount(html`<textarea value="b"></textarea>`);
    expect(root.querySelector('textarea')).toBe(first);
  });
  it('sets a select to the chosen option', () => {
    const root = mount(
      html`<select value="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>`,
    );
    expect((root.querySelector('select') as HTMLSelectElement).value).toBe('b');
    mount(
      html`<select value="a">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>`,
    );
    expect((root.querySelector('select') as HTMLSelectElement).value).toBe('a');
  });
  it('does not touch the value of a file input', () => {
    const root = mount(html`<input type="file" value="ignored" />`);
    expect((root.querySelector('input') as HTMLInputElement).type).toBe('file');
  });
});

describe('CompatField: checked', () => {
  it('follows the checked prop and puts it back when a render disagrees', () => {
    const root = mount(html`<input type="checkbox" checked=${true} />`);
    const box1 = root.querySelector('input') as HTMLInputElement;
    expect(box1.checked).toBe(true);
    box1.checked = false;
    mount(html`<input type="checkbox" checked=${true} />`);
    expect(box1.checked).toBe(true);
    mount(html`<input type="checkbox" checked=${false} />`);
    expect(box1.checked).toBe(false);
  });
});

describe('CompatField: onChange is the native change event', () => {
  it('does not fire on every keystroke', () => {
    const fn = vi.fn();
    const root = mount(html`<input value="" onChange=${fn} />`);
    type(root.querySelector('input') as HTMLInputElement, 'a');
    expect(fn).not.toHaveBeenCalled();
  });
  it('fires once per change event', () => {
    const fn = vi.fn();
    const root = mount(html`<input value="" onChange=${fn} />`);
    const input = root.querySelector('input') as HTMLInputElement;
    input.value = 'x';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].target).toBe(input);
  });
  it('fires once for a checkbox and for a select, even after re-rendering', () => {
    const a = vi.fn();
    const b = vi.fn();
    const view = () =>
      html`<div>
        <input type="checkbox" checked=${false} onChange=${a} /><select value="a" onChange=${b}>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
      </div>`;
    const root = mount(view());
    mount(view());
    mount(view());
    root.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    root.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
  it('calls the newest handler, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const root = mount(html`<input value="" onChange=${first} />`);
    mount(html`<input value="" onChange=${second} />`);
    root.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('stops listening when the handler is removed', () => {
    const fn = vi.fn();
    const root = mount(html`<input value="" onChange=${fn} />`);
    mount(html`<input value="" />`);
    root.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(fn).not.toHaveBeenCalled();
  });
  it('lets onInput run on every keystroke', () => {
    const fn = vi.fn();
    const root = mount(html`<input value="" onInput=${fn} />`);
    type(root.querySelector('input') as HTMLInputElement, 'a');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('CompatField: refs', () => {
  it('hands the element to an object ref and a function ref', () => {
    const obj: { current: unknown } = { current: null };
    const fn = vi.fn();
    const root = mount(html`<div><input ref=${obj} /><textarea ref=${fn}></textarea></div>`);
    expect(obj.current).toBe(root.querySelector('input'));
    expect(fn).toHaveBeenCalledWith(root.querySelector('textarea'));
  });
  it('tells a new ref about the element, and the old one that it is gone', () => {
    const one = vi.fn();
    const two = vi.fn();
    const root = mount(html`<input ref=${one} />`);
    mount(html`<input ref=${two} />`);
    expect(one).toHaveBeenLastCalledWith(null);
    expect(two).toHaveBeenCalledWith(root.querySelector('input'));
  });
  it('does not call a stable ref again on every render', () => {
    const fn = vi.fn();
    mount(html`<input ref=${fn} />`);
    const calls = fn.mock.calls.length;
    mount(html`<input ref=${fn} />`);
    mount(html`<input ref=${fn} />`);
    expect(fn.mock.calls.length).toBe(calls);
  });
});

describe('CompatField: markup', () => {
  it('passes attributes through, with Preact names renamed', () => {
    const root = mount(html`<input class="x" maxlength="5" readonly placeholder="p" />`);
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.className).toBe('x');
    expect(input.maxLength).toBe(5);
    expect(input.readOnly).toBe(true);
    expect(input.placeholder).toBe('p');
  });
  it('draws the options of a select', () => {
    const root = mount(html`<select><${'option'} value="a">A</${'option'}><option value="b">B</option></select>`);
    expect(root.querySelectorAll('option').length).toBe(2);
  });
});
