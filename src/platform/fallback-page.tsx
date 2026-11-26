'use client';

import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import { useSyncExternalStore, type ReactNode } from 'react';

const DARK = '(prefers-color-scheme: dark)';
const subscribe = (on: () => void) => {
  const q = window.matchMedia?.(DARK);
  q?.addEventListener?.('change', on);
  return () => q?.removeEventListener?.('change', on);
};
const isDark = () => !!window.matchMedia?.(DARK).matches;

type Action = { label: string; primary?: boolean } & ({ href: string } | { onClick: () => void });

/**
 * A whole-page message for Next's error and not-found screens: Fluent's message bar in the page's colour scheme, a
 * plain explanation and one or two ways on. Used where the workspace itself is not running.
 */
export function FallbackPage({
  intent,
  title,
  children,
  actions,
}: {
  intent: 'error' | 'warning' | 'info';
  title: string;
  children: ReactNode;
  actions: Action[];
}) {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <main role="main" style={{ maxWidth: 560, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MessageBar intent={intent} layout="multiline" role={intent === 'error' ? 'alert' : 'status'}>
          <MessageBarBody>
            <MessageBarTitle>{title}</MessageBarTitle>
            {children}
          </MessageBarBody>
        </MessageBar>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.map((a) =>
            'href' in a ? (
              <Button key={a.label} as="a" href={a.href} appearance={a.primary ? 'primary' : 'secondary'}>
                {a.label}
              </Button>
            ) : (
              <Button key={a.label} onClick={a.onClick} appearance={a.primary ? 'primary' : 'secondary'}>
                {a.label}
              </Button>
            ),
          )}
        </div>
      </main>
    </FluentProvider>
  );
}
