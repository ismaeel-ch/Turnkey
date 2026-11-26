/**
 * Pure helpers behind the command palette and the keyboard shortcuts: ranking commands against what was typed, and
 * reading a key press into one short name. Nothing here touches the DOM, so it runs in unit tests as it is.
 */

/** What the palette ranks: a title, the group it shows under, and other words people might type for it. */
export interface Rankable {
  title: string;
  group: string;
  keywords?: string;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * How well `query` matches a command: 0 means not at all. Every word typed must start a word of the title, group or
 * keywords, or (failing that) appear inside them. A match at the start of the title ranks highest.
 */
export function scoreCommand(c: Rankable, query: string): number {
  const q = words(query);
  if (!q.length) return 1;
  const title = c.title.toLowerCase();
  const own = words(c.title);
  const other = words(c.group + ' ' + (c.keywords || ''));
  const hay = (c.title + ' ' + c.group + ' ' + (c.keywords || '')).toLowerCase();
  let score = 0;
  for (const w of q) {
    if (own.some((x) => x.startsWith(w))) score += 10;
    else if (other.some((x) => x.startsWith(w))) score += 5;
    else if (hay.includes(w)) score += 1;
    else return 0;
  }
  if (title.startsWith(query.trim().toLowerCase())) score += 20;
  return score;
}

/** The commands that match, best first. Ties keep the order they were given in, so groups stay together. */
export function rankCommands<T extends Rankable>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return items.slice();
  return items
    .map((c, i) => ({ c, i, s: scoreCommand(c, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

/** The parts of a keyboard event the shortcuts read. */
export interface KeyPress {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * One short name for a key press: "mod+k" for Ctrl+K or Cmd+K, "?" for the question mark, "g" for a plain letter.
 * Shift is folded into the character it makes ("?", "A"); Alt with a character gives null, because on many keyboards
 * Alt types letters, and those must reach the page.
 */
export function keyName(e: KeyPress): string | null {
  const k = e.key;
  if (!k || k === 'Dead' || k === 'Unidentified') return null;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(k)) return null;
  const mod = !!(e.ctrlKey || e.metaKey);
  if (mod && e.altKey) return null;
  const base = k.length === 1 ? k.toLowerCase() : k;
  if (mod) return 'mod+' + (e.shiftKey ? 'shift+' : '') + base;
  if (e.altKey) return null;
  return k;
}

/** How a shortcut is written on screen for this device: ⌘ on Apple keyboards, Ctrl elsewhere. */
export function keyLabel(name: string, apple: boolean): string[] {
  return name.split(' ').map((part) =>
    part
      .split('+')
      .map((p) => (p === 'mod' ? (apple ? '⌘' : 'Ctrl') : p === 'shift' ? 'Shift' : p.length === 1 ? p.toUpperCase() : p))
      .join(apple ? '' : '+'),
  );
}
