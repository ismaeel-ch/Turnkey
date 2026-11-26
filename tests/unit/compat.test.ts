import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CompatField } from '@/platform/compat/field';
import { domProps, h, html, styleFromString } from '@/platform/compat/html';

describe('styleFromString', () => {
  it('turns a style string into the object React wants', () => {
    expect(styleFromString('width:10px;height:20px')).toEqual({ width: '10px', height: '20px' });
    expect(styleFromString('flex-grow:1.5; padding-left: 4px;')).toEqual({ flexGrow: '1.5', paddingLeft: '4px' });
  });
  it('keeps custom properties, and semicolons inside brackets and quotes', () => {
    expect(styleFromString('--acc:#fff;background:url(data:image/svg+xml;base64,AAA)')).toEqual({
      '--acc': '#fff',
      background: 'url(data:image/svg+xml;base64,AAA)',
    });
    expect(styleFromString("height:clamp(460px,calc(100dvh - 330px),900px);content:'a;b'")).toEqual({
      height: 'clamp(460px,calc(100dvh - 330px),900px)',
      content: "'a;b'",
    });
  });
  it('handles vendor prefixes and empty input', () => {
    expect(styleFromString('-webkit-line-clamp:2;-ms-flex:1')).toEqual({ WebkitLineClamp: '2', msFlex: '1' });
    expect(styleFromString('')).toEqual({});
  });
});

describe('domProps', () => {
  it('renames HTML and SVG attributes for React', () => {
    expect(domProps({ class: 'a', for: 'x', tabindex: '-1', maxlength: '3', 'stroke-width': 2, 'text-anchor': 'middle' })).toEqual({
      className: 'a',
      htmlFor: 'x',
      tabIndex: '-1',
      maxLength: '3',
      strokeWidth: 2,
      textAnchor: 'middle',
    });
  });
  it('leaves data, aria and unknown names alone, and parses style strings', () => {
    expect(domProps({ 'data-tour': 't', 'aria-label': 'L', viewBox: '0 0 1 1', style: 'left:1px' })).toEqual({
      'data-tour': 't',
      'aria-label': 'L',
      viewBox: '0 0 1 1',
      style: { left: '1px' },
    });
  });
  it('spells event names the way React does', () => {
    const fn = () => {};
    expect(Object.keys(domProps({ onClick: fn, ondblclick: fn, onDblClick: fn, onkeydown: fn, onFocusOut: fn }))).toEqual([
      'onClick',
      'onDoubleClick',
      'onKeydown',
      'onBlur',
    ]);
  });
  it('drops a class that is false or null', () => {
    expect(domProps({ class: false })).toEqual({ className: undefined });
  });
});

describe('h and html: children', () => {
  it('leaves out a child that is a plain object or a function, as Preact does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(renderToStaticMarkup(h('p', null, 'a', { not: 'text' }, () => 1, 'b'))).toBe('<p>ab</p>');
    warn.mockRestore();
  });
  it('passes arrays through, including nested arrays', () => {
    expect(renderToStaticMarkup(h('ul', null, [h('li', null, 'one'), [h('li', null, 'two')]]))).toBe('<ul><li>one</li><li>two</li></ul>');
  });
  it('draws a bigint as text', () => {
    expect(renderToStaticMarkup(h('span', null, BigInt('12345678901234567890')))).toBe('<span>12345678901234567890</span>');
  });
  it('draws numbers, booleans and null as React does, with html tagged templates too', () => {
    expect(renderToStaticMarkup(html`<b class="total">${3} items${null}${false}</b>`)).toBe('<b class="total">3 items</b>');
  });
});

describe('h: components and fields', () => {
  it('gives a component its props untouched, with the names the modules used', () => {
    let received: Record<string, unknown> | null = null;
    function Card(props: Record<string, unknown>) {
      received = props;
      return h('div', null, 'card');
    }
    const style = 'color:red';
    renderToStaticMarkup(h(Card, { class: 'x', style, onclick: () => {} }));
    expect(received).toMatchObject({ class: 'x', style });
    expect(received).not.toHaveProperty('className');
    expect(received).toHaveProperty('onclick');
  });
  it('renames the props of an element for React', () => {
    expect(renderToStaticMarkup(h('label', { class: 'l', for: 'name', tabindex: '0' }, 'Name'))).toBe(
      '<label class="l" for="name" tabindex="0">Name</label>',
    );
  });
  it('wraps a form field in the field component, and leaves other elements alone', () => {
    expect(h('input', { value: 'a' }).type).toBe(CompatField);
    expect(h('textarea', { value: 'a' }).type).toBe(CompatField);
    expect(h('select', null).type).toBe(CompatField);
    expect(h('button', null, 'go').type).toBe('button');
  });
  it('passes the key of a field on, so the list still updates correctly', () => {
    const el = h('input', { key: 'row-1', value: 'x' });
    expect(el.key).toBe('row-1');
  });
});
