/**
 * Starts the workspace.
 *
 * The modules in src/legacy read their libraries from the page, the way the prototype's single HTML file gave them:
 * `window.htmPreact` (markup tag, render, hooks), `window.initSqlJs` (SQLite), `window.React`, `window.ReactDOM` and
 * `window.ReactFlow` (the workflow canvas), `window.claude` (model access and downloads). This file puts React
 * behind every one of those names and then runs the bundle.
 */
import * as ReactFlow from '@xyflow/react';
import * as React from 'react';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root, type RootOptions } from 'react-dom/client';
import { html } from './compat/html';
import { render } from './compat/render';
import assets from './generated/assets.json';
import { createHost } from './model-client';

type SqlInit = (config?: Record<string, unknown>) => Promise<unknown>;
/** The names the workspace modules read from the page. */
type Host = {
  htmPreact?: unknown;
  initSqlJs?: SqlInit;
  React?: unknown;
  ReactDOM?: unknown;
  ReactFlow?: unknown;
  claude?: unknown;
  __formworkFlow?: (ok: boolean) => void;
  __turnkey?: { booted: boolean };
  /** Set before the page starts. `canvas: false` shows the plain line of stations instead of the workflow canvas. */
  __turnkeyOptions?: { canvas?: boolean };
};

/**
 * Roots the workspace creates for itself (the workflow canvas lives in one). React would draw an update to such a
 * root a frame or two after the page around it; this draws it as soon as the current task ends, so the canvas never
 * shows an older state than the panels beside it.
 */
function createEagerRoot(container: Element | DocumentFragment, options?: RootOptions): Root {
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

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

export async function boot(): Promise<void> {
  const w = window as unknown as Host;
  if (w.__turnkey?.booted) return;
  w.__turnkey = { booted: true };

  w.htmPreact = { html, render, useState, useEffect, useLayoutEffect, useRef, useReducer };
  const canvas = w.__turnkeyOptions?.canvas !== false;
  w.React = React;
  w.ReactDOM = { createRoot: createEagerRoot, flushSync };
  if (canvas) w.ReactFlow = ReactFlow;
  w.claude = w.claude || createHost();

  // SQLite runs in the browser. The engine is a static file, and the modules call initSqlJs({}) with no paths.
  // If it cannot be fetched the workspace still starts and says so on its own start screen.
  try {
    await loadScript(assets.sqlJs);
    const init = w.initSqlJs;
    if (typeof init === 'function') w.initSqlJs = (config) => init({ locateFile: () => assets.sqlWasm, ...(config || {}) });
  } catch (e) {
    console.warn('[turnkey] SQLite engine not loaded', e);
  }

  const { default: bootLegacy } = await import('./generated/legacy');
  bootLegacy();
  w.__formworkFlow?.(canvas);
}
