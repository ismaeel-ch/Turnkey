import { describe, expect, it } from 'vitest';
import { domProps, styleFromString } from '@/platform/compat/html';

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
