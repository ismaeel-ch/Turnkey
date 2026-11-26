/**
 * Preact's `render(vnode, container)` on top of React roots.
 *
 * The workspace modules expect three things of it: the DOM is there when the call returns (they measure and count
 * what was drawn straight after), an error thrown while drawing reaches the caller, and `render(null, container)`
 * clears the container. React's roots are asynchronous and report errors to a callback, so this wraps them.
 */
import { createElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorScreen } from './error-screen';

type Mounted = { root: Root; failed: unknown; hasFailed: boolean };
const mounted = new WeakMap<Element, Mounted>();

export function render(vnode: unknown, container: Element | null): void {
  if (!container) return;
  let m = mounted.get(container);
  if (vnode == null) {
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
      // No boundary caught it: hand it to whoever called render(), as Preact would have thrown it there.
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
  // The workspace itself gets a boundary, so one screen failing to draw does not blank the page.
  const tree = container.id === 'root' ? createElement(ErrorScreen, null, vnode as ReactNode) : (vnode as ReactNode);
  const target = m;
  flushSync(() => target.root.render(tree));
  if (target.hasFailed) {
    const error = target.failed;
    target.failed = undefined;
    target.hasFailed = false;
    throw error;
  }
}
