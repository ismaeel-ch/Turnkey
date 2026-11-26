/**
 * Turns the Markdown that the deliverable is written in into HTML for the printable page. It covers only what the
 * deliverable uses: headings, paragraphs, bullet and numbered lists, tables, fenced code, quotes, bold, italic,
 * inline code and rules. Everything is escaped first, so text from a build (which may come from a model) can never
 * become markup.
 */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Inline marks on one escaped line: `code`, **bold**, _italic_ and *italic*. Code spans are kept as they are. */
export function inline(text: string): string {
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map((part) =>
      /^`[^`]+`$/.test(part)
        ? '<code>' + part.slice(1, -1) + '</code>'
        : part
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[\s(“"])_([^_]+)_(?=$|[\s).,;:!?”"])/g, '$1<em>$2</em>')
            .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>'),
    )
    .join('');
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());

/** A heading's text as an id for links inside the page. */
export const slug = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'section';

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n'),
    out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{1,6}\s|```|>\s?|[-*]\s|\d+\.\s|\|)/.test(l) || /^(-{3,}|\*{3,})\s*$/.test(l) || !l.trim();
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim(),
        body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push('<pre' + (lang ? ' data-lang="' + escapeHtml(lang) + '"' : '') + '><code>' + escapeHtml(body.join('\n')) + '</code></pre>');
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      const n = h[1].length;
      out.push('<h' + n + ' id="' + slug(h[2]) + '">' + inline(h[2]) + '</h' + n + '>');
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(l)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push('<blockquote><p>' + body.map(inline).join('<br>') + '</p></blockquote>');
      continue;
    }
    if (/^[-*]\s/.test(l) || /^\d+\.\s/.test(l)) {
      const ordered = /^\d+\.\s/.test(l),
        re = ordered ? /^\d+\.\s+/ : /^[-*]\s+/,
        items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push('<' + tag + '>' + items.map((x) => '<li>' + inline(x) + '</li>').join('') + '</' + tag + '>');
      continue;
    }
    if (l.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>' +
          head.map((c) => '<th>' + inline(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] ?? '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>',
      );
      continue;
    }
    const para: string[] = [l];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) para.push(lines[i++]);
    out.push('<p>' + para.map(inline).join(' ') + '</p>');
  }
  return out.join('\n');
}
