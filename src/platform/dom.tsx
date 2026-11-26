'use client';
/**
 * DOM helpers the workspace modules share.
 *
 * - `NativeField`: an uncontrolled form field whose `value`/`checked` props are written to the DOM after each render
 *   only when they differ, and whose `onChange` is the browser's native `change` event (fired when an edit is
 *   committed, not on every key). Typing is never undone by a re-render. Use `onInput` for per-key updates.
 * - `toStyle`: accepts a CSS declaration string or a style object and returns a React style object.
 * - `render`: synchronous render into a detached container. The workspace's self-tests mount a screen, inspect the
 *   DOM straight away and unmount it (`render(null, el)`); errors thrown while drawing reach the caller.
 * - `createEagerRoot`: a React root whose updates are flushed at the end of the current task, so a nested root
 *   (the workflow canvas) never shows an older state than the panels around it.
 */
/* eslint-disable react-hooks/refs -- the ref callback receives the DOM node from React; no ref is read while rendering */
import { Children, createElement, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root, type RootOptions } from 'react-dom/client';

type Props = Record<string, unknown>;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/* ---------- styles ---------- */

const cssName = (name: string) =>
  name.startsWith('--') ? name : name.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Turns `width:10px;height:calc(1px + 2px)` into a style object. Semicolons inside brackets or quotes are kept. */
export function styleFromString(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0;
  let quote = '';
  let start = 0;
  const parts: string[] = [];
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

export function toStyle(value: unknown): Record<string, string | number> | undefined {
  if (value == null || value === false || value === '') return undefined;
  if (typeof value === 'string') return styleFromString(value);
  return value as Record<string, string | number>;
}

/* ---------- form fields ---------- */

function assign(ref: unknown, el: FieldElement | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = el;
}

export function NativeField({ as: tag, children, ...fwd }: Props & { as: 'input' | 'textarea' | 'select'; children?: ReactNode }) {
  const el = useRef<FieldElement | null>(null);
  const { value, checked, onChange, ref, ...rest } = fwd;
  const change = useRef(onChange);
  const outer = useRef(ref);
  const hasValue = 'value' in fwd && rest.type !== 'file';
  const hasChecked = 'checked' in fwd;

  // After every render the props win over what the DOM holds, and only if they differ.
  useLayoutEffect(() => {
    change.current = onChange;
    const node = el.current;
    if (outer.current !== ref) {
      assign(outer.current, null);
      outer.current = ref;
      assign(ref, node);
    }
    if (!node) return;
    if (hasValue) {
      const next = value == null ? '' : String(value);
      if (node.value !== next) node.value = next;
    }
    if (hasChecked && 'checked' in node) {
      const next = !!checked;
      if (node.checked !== next) node.checked = next;
    }
  });

  const listens = typeof onChange === 'function';
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !listens) return;
    const handler = (e: Event) => {
      const fn = change.current;
      if (typeof fn === 'function') fn(e);
    };
    node.addEventListener('change', handler);
    return () => node.removeEventListener('change', handler);
  }, [listens]);

  const setRef = useCallback((node: FieldElement | null) => {
    el.current = node;
    assign(outer.current, node);
  }, []);

  const props: Props = { ...rest, ref: setRef };
  if (hasValue) props.defaultValue = value == null ? '' : (value as string);
  if (hasChecked) props.defaultChecked = !!checked;
  return children === undefined ? createElement(tag, props) : createElement(tag, props, ...Children.toArray(children));
}

/* ---------- synchronous mounting for self-tests ---------- */

type Mounted = { root: Root; failed: unknown; hasFailed: boolean };
const mounted = new WeakMap<Element, Mounted>();

export function render(node: ReactNode, container: Element | null): void {
  if (!container) return;
  let m = mounted.get(container);
  if (node == null) {
    if (m) {
      mounted.delete(container);
      const { root } = m;
      flushSync(() => root.unmount());
    }
    return;
  }
  if (!m) {
    const entry: Mounted = { root: null as unknown as Root, failed: undefined, hasFailed: false };
    entry.root = createRoot(container, {
      onUncaughtError: (error) => {
        entry.failed = error;
        entry.hasFailed = true;
      },
    });
    mounted.set(container, entry);
    m = entry;
  }
  m.failed = undefined;
  m.hasFailed = false;
  const target = m;
  flushSync(() => target.root.render(node));
  if (target.hasFailed) {
    const error = target.failed;
    target.failed = undefined;
    target.hasFailed = false;
    throw error;
  }
}

/* ---------- nested roots ---------- */

export function createEagerRoot(container: Element | DocumentFragment, options?: RootOptions): Root {
  const root = createRoot(container, options);
  let alive = true;
  return {
    render(children) {
      queueMicrotask(() => {
        if (alive) flushSync(() => root.render(children));
      });
    },
    unmount() {
      alive = false;
      root.unmount();
    },
  };
}
