'use client';
/**
 * The deliverable as one printable HTML page, and printing it. The page carries its own print styles, so the
 * browser's "Save as PDF" gives a clean document: A4, black on white, tables that do not split rows across pages,
 * and a heading never left alone at the bottom of a page.
 */
import { escapeHtml, markdownToHtml } from './markdown';

const STYLE = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#242424;font:14px/1.5 "Segoe UI","Segoe UI Web (West European)",-apple-system,BlinkMacSystemFont,Roboto,"Helvetica Neue",sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 24px 64px}
h1{font-size:28px;line-height:36px;font-weight:600;margin:0 0 8px}
h2{font-size:20px;line-height:28px;font-weight:600;margin:32px 0 8px;padding-top:8px;border-top:1px solid #e0e0e0}
h3{font-size:16px;line-height:22px;font-weight:600;margin:20px 0 6px}
p,ul,ol,blockquote,table,pre{margin:0 0 12px}
ul,ol{padding-left:24px}
li{margin:2px 0}
blockquote{margin-left:0;padding:8px 16px;border-left:4px solid #0f6cbd;background:#f5f5f5}
code{font:12px/1.4 Consolas,"Cascadia Mono",Menlo,monospace;background:#f5f5f5;padding:1px 4px;border-radius:4px}
pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #d1d1d1;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#fafafa;font-weight:600}
hr{border:0;border-top:1px solid #e0e0e0;margin:24px 0}
em{color:#616161}
@page{size:A4;margin:16mm 14mm}
@media print{
  main{max-width:none;padding:0}
  h2{break-after:avoid;page-break-after:avoid}
  h3{break-after:avoid;page-break-after:avoid}
  tr,pre,blockquote,li{break-inside:avoid;page-break-inside:avoid}
  thead{display:table-header-group}
  pre{white-space:pre-wrap}
}`;

/** A complete HTML document for the Markdown, ready to open, save or print. */
export function printableHtml(title: string, markdown: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' +
    escapeHtml(title) +
    '</title><style>' +
    STYLE +
    '</style></head><body><main>' +
    markdownToHtml(markdown) +
    '</main></body></html>'
  );
}

/**
 * Prints an HTML document from a hidden frame, so no new window opens and no pop-up blocker gets in the way. The
 * browser's print dialog offers "Save as PDF". Returns false when the page cannot print.
 */
export function printHtml(html: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    document.getElementById('tk-print-frame')?.remove();
    const f = document.createElement('iframe');
    f.id = 'tk-print-frame';
    f.title = 'Printable document';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const w = f.contentWindow,
      d = f.contentDocument;
    if (!w || !d) return false;
    d.open();
    d.write(html);
    d.close();
    // give the frame a moment to lay out before the dialog opens
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* printing was refused; the frame stays for the next try */
      }
    }, 50);
    return true;
  } catch {
    return false;
  }
}
