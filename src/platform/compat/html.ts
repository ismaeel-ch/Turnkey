/**
 * The `html` tag the workspace modules use, bound to React.
 *
 * The modules in src/legacy were written against htm + Preact. Preact accepts HTML attribute names (`class`, `for`,
 * `tabindex`, `stroke-width`), style strings, and form fields that keep what the user typed between renders.
 * React does not. This file translates one into the other at element-creation time, so the modules run on React
 * without being rewritten.
 */
import htm from 'htm';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { CompatField } from './field';

type Props = Record<string, unknown>;

/** HTML and SVG attribute names as Preact takes them, mapped to the property names React expects. */
const ALIASES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  autofocus: 'autoFocus',
  autocomplete: 'autoComplete',
  autocapitalize: 'autoCapitalize',
  spellcheck: 'spellCheck',
  contenteditable: 'contentEditable',
  enterkeyhint: 'enterKeyHint',
  inputmode: 'inputMode',
  novalidate: 'noValidate',
  crossorigin: 'crossOrigin',
  srcset: 'srcSet',
  datetime: 'dateTime',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-opacity': 'strokeOpacity',
  'stroke-miterlimit': 'strokeMiterlimit',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'clip-path': 'clipPath',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
  'alignment-baseline': 'alignmentBaseline',
  'font-size': 'fontSize',
  'font-weight': 'fontWeight',
  'font-family': 'fontFamily',
  'letter-spacing': 'letterSpacing',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'flood-color': 'floodColor',
  'flood-opacity': 'floodOpacity',
  'color-interpolation-filters': 'colorInterpolationFilters',
  'vector-effect': 'vectorEffect',
  'shape-rendering': 'shapeRendering',
  'pointer-events': 'pointerEvents',
  'paint-order': 'paintOrder',
  'marker-start': 'markerStart',
  'marker-mid': 'markerMid',
  'marker-end': 'markerEnd',
  'text-decoration': 'textDecoration',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
};

/** Event names Preact takes (native names, any case) that React spells differently. Keys are lower case. */
const EVENTS: Record<string, string> = {
  ondblclick: 'onDoubleClick',
  onfocusin: 'onFocus',
  onfocusout: 'onBlur',
};

const cssName = (name: string) =>
  name.startsWith('--') ? name : name.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Turns `width:10px;height:calc(1px + 2px)` into the object React wants. Semicolons inside brackets or quotes are kept. */
export function styleFromString(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  for (const part of parts) {
    const at = part.indexOf(':');
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const value = part
      .slice(at + 1)
      .trim()
      .replace(/\s*!important$/i, '');
    if (name && value) out[cssName(name)] = value;
  }
  return out;
}

/** Props for a DOM element, renamed for React. Components get their props untouched. */
export function domProps(props: Props): Props {
  const out: Props = {};
  for (const key in props) {
    let value = props[key];
    let name = ALIASES[key] ?? key;
    if (name === key && key.length > 2 && key[0] === 'o' && key[1] === 'n') {
      const lower = key.toLowerCase();
      if (EVENTS[lower]) name = EVENTS[lower];
      else if (key[2] !== key[2].toUpperCase()) name = 'on' + key[2].toUpperCase() + key.slice(3); // onclick → onClick
    }
    if (name === 'style' && typeof value === 'string') value = styleFromString(value);
    else if (name === 'className' && (value === false || value === null)) value = undefined;
    out[name] = value;
  }
  return out;
}

let warned = 0;
/** Preact draws nothing for a child that is a plain object or a function. React throws. Keep Preact's behaviour. */
function child(c: unknown): ReactNode {
  if (c == null || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return c as ReactNode;
  if (Array.isArray(c)) return c.map(child);
  if (typeof c === 'bigint') return String(c);
  if (typeof c === 'object' && isValidElement(c)) return c;
  if (process.env.NODE_ENV !== 'production' && warned++ < 5)
    console.warn('[compat] a child that is not text or an element was left out', c);
  return null;
}

const FIELDS = new Set(['input', 'textarea', 'select']);

export function h(type: unknown, props: Props | null, ...children: unknown[]): ReactElement {
  const kids = children.map(child);
  if (typeof type !== 'string') return createElement(type as never, props, ...kids);
  const p = props ? domProps(props) : null;
  if (FIELDS.has(type))
    return createElement(CompatField, { tag: type, fwd: p ?? {}, key: (p?.key as string | undefined) ?? undefined }, ...kids);
  return createElement(type, p, ...kids);
}

/** Tagged template for markup. One root gives an element, several give an array, like htm with Preact. */
export const html = htm.bind(h) as (strings: TemplateStringsArray, ...values: unknown[]) => ReactElement | ReactElement[];
