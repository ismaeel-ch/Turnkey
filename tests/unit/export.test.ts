import { describe, expect, it } from 'vitest';
import { crc32, zip } from '@/platform/export/zip';
import { escapeHtml, inline, markdownToHtml } from '@/platform/export/markdown';
import { printableHtml } from '@/platform/export/print';

/** Reads a stored (uncompressed) zip back through its central directory. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    dec = new TextDecoder(),
    end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const size = v.getUint32(at + 24, true),
      crc = v.getUint32(at + 16, true),
      nlen = v.getUint16(at + 28, true),
      off = v.getUint32(at + 42, true),
      name = dec.decode(bytes.subarray(at + 46, at + 46 + nlen));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const lnlen = v.getUint16(off + 26, true),
      data = bytes.subarray(off + 30 + lnlen, off + 30 + lnlen + size);
    expect(crc32(data)).toBe(crc);
    out[name] = dec.decode(data);
    at += 46 + nlen;
  }
  return out;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('packs text and bytes that read back the same', () => {
    const z = zip([
      { name: 'pack/a.md', data: '# Hello · café' },
      { name: 'pack/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const files = unzip(z);
    expect(Object.keys(files)).toEqual(['pack/a.md', 'pack/b.bin']);
    expect(files['pack/a.md']).toBe('# Hello · café');
    expect(files['pack/b.bin'].length).toBe(4);
  });

  it('cleans names so nothing unpacks outside its folder', () => {
    const files = unzip(
      zip([
        { name: '../../etc/x.txt', data: 'x' },
        { name: '\\a\\b.txt', data: 'y' },
        { name: '..', data: 'z' },
      ]),
    );
    expect(Object.keys(files)).toEqual(['etc/x.txt', 'a/b.txt', 'file']);
  });
});

describe('markdown to html', () => {
  it('escapes everything first', () => {
    expect(escapeHtml('<script>"&\'')).toBe('&lt;script&gt;&quot;&amp;&#39;');
    expect(markdownToHtml('Hi <img src=x onerror=alert(1)>')).toBe('<p>Hi &lt;img src=x onerror=alert(1)&gt;</p>');
    expect(markdownToHtml('```sql\n<b>\n```')).toContain('&lt;b&gt;');
  });

  it('renders inline marks and leaves code spans alone', () => {
    expect(inline('**Roles** and _note_ and `a **b**`')).toBe('<strong>Roles</strong> and <em>note</em> and <code>a **b**</code>');
    expect(inline('snake_case_name stays')).toBe('snake_case_name stays');
  });

  it('renders the blocks the deliverable uses', () => {
    const html = markdownToHtml(
      [
        '# App · deliverable',
        '',
        '> one line',
        '',
        '- one',
        '- two',
        '',
        '1. PASS · first',
        '2. FAIL · second',
        '',
        '| A | B |',
        '|---|---|',
        '| x \\| y | `z` |',
        '',
        '```sql',
        'CREATE TABLE t (id INTEGER);',
        '```',
        '',
        '---',
        'a paragraph',
        'that wraps',
      ].join('\n'),
    );
    expect(html).toContain('<h1 id="app-deliverable">App · deliverable</h1>');
    expect(html).toContain('<blockquote><p>one line</p></blockquote>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>PASS · first</li><li>FAIL · second</li></ol>');
    expect(html).toContain('<th>A</th><th>B</th>');
    expect(html).toContain('<td>x | y</td><td><code>z</code></td>');
    expect(html).toContain('<pre data-lang="sql"><code>CREATE TABLE t (id INTEGER);</code></pre>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<p>a paragraph that wraps</p>');
  });

  it('makes a whole printable page with print styles and an escaped title', () => {
    const page = printableHtml('A <b> app', '# Hi');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>A &lt;b&gt; app</title>');
    expect(page).toContain('@media print');
    expect(page).toContain('<h1 id="hi">Hi</h1>');
  });
});
