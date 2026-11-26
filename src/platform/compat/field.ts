/**
 * Form fields with Preact's behaviour, drawn by React.
 *
 * In Preact a field's `value` (or `checked`) is written to the DOM when a render finds it different, and between
 * renders the field is the user's: typing is never undone. `onChange` is the browser's `change` event, which a text
 * field fires when the edit is committed, not on every key. React's controlled inputs differ on both counts, so
 * fields are rendered uncontrolled here and brought in line with their props after every render.
 */
/* eslint-disable react-hooks/refs -- the ref callback below receives the DOM node from React; no ref is read while rendering */
import { Children, createElement, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';

type Props = Record<string, unknown>;
type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function assign(ref: unknown, el: FieldElement | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = el;
}

export function CompatField({ tag, fwd, children }: { tag: string; fwd: Props; children?: ReactNode }) {
  const el = useRef<FieldElement | null>(null);
  const { value, checked, onChange, ref, key: _key, ...rest } = fwd;
  void _key;
  const change = useRef(onChange);
  const outer = useRef(ref);
  const hasValue = 'value' in fwd && rest.type !== 'file';
  const hasChecked = 'checked' in fwd;

  // After every render: what the props say wins over what the DOM holds, and only if they differ.
  useLayoutEffect(() => {
    change.current = onChange;
    const node = el.current;
    if (outer.current !== ref) {
      // a new ref from the caller is told about the element again, as Preact does
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

  // `onChange` is the native change event, as it was under Preact.
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

  // One stable callback: React would otherwise detach and re-attach the ref on every render.
  const setRef = useCallback((node: FieldElement | null) => {
    el.current = node;
    assign(outer.current, node);
  }, []);

  const props: Props = { ...rest, ref: setRef };
  if (hasValue) props.defaultValue = value == null ? '' : (value as string);
  if (hasChecked) props.defaultChecked = !!checked;
  return children === undefined ? createElement(tag, props) : createElement(tag, props, ...Children.toArray(children));
}
