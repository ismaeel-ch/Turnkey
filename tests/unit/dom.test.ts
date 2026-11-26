import { describe, expect, it } from 'vitest';
import { styleFromString, toStyle } from '@/platform/dom';

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

describe('toStyle', () => {
  it('passes objects through, parses strings, and drops empty values', () => {
    expect(toStyle({ width: 1 })).toEqual({ width: 1 });
    expect(toStyle('left:1px')).toEqual({ left: '1px' });
    expect(toStyle('')).toBeUndefined();
    expect(toStyle(null)).toBeUndefined();
  });
});
