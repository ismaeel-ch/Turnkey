'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { bootScreenDone } from './boot-intent';

/**
 * The outermost boundary of the workspace. A render error in React takes the whole tree down, so the page would go
 * blank. This keeps the page, says what happened and lets the person carry on: their apps and data are in browser
 * storage and are not touched by a drawing error.
 */
export class ErrorScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[turnkey] the workspace could not draw', error, info.componentStack);
    bootScreenDone(); // so this message is not hidden behind the boot screen
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="splash" role="alert">
        <strong className="t-sub1">This screen could not be drawn</strong>
        <p className="muted">Your apps and their data are saved in this browser and were not changed.</p>
        <p className="muted t-cap mono">{String(error.message || error)}</p>
        <div className="row">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
