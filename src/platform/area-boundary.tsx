'use client';

import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from '@fluentui/react-components';
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  /** What this part of the screen is, in plain words: "This view", "The chat", "The agent panel". */
  name: string;
  /** When this changes (another app, another view), a part that failed is drawn again. */
  resetKey?: unknown;
  children: ReactNode;
};

/**
 * A boundary around one part of the workspace. A drawing error there shows a Fluent message bar in its place and
 * leaves the rest of the screen working, instead of taking the whole page down to the outer ErrorScreen.
 */
export class AreaBoundary extends Component<Props, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('unknown error') };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[turnkey] ' + this.props.name + ' could not draw', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <div className="area-error" data-area-error={this.props.name} style={{ padding: 12 }}>
        <MessageBar intent="error" layout="multiline" role="alert">
          <MessageBarBody>
            <MessageBarTitle>{this.props.name} could not be shown.</MessageBarTitle>
            Your apps and their data are saved in this browser and were not changed.
            {detail && <div className="t-cap mono area-error-detail">{detail}</div>}
          </MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
          </MessageBarActions>
        </MessageBar>
      </div>
    );
  }
}
