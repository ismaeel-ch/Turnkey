'use client';

import { useEffect } from 'react';

/**
 * The last fallback, used only when the root layout itself fails. It replaces the whole document, so it carries its
 * own minimal styles and no libraries: whatever broke the layout may have broken them too.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[turnkey] the page could not start', error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          display: 'grid',
          placeItems: 'center',
          minHeight: '100dvh',
          colorScheme: 'light dark',
        }}
      >
        <title>Turnkey could not start</title>
        <main style={{ maxWidth: 520, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Turnkey could not start</h1>
          <p style={{ margin: 0 }}>
            Your apps and their data are saved in this browser and were not changed. Try again, or reload the page.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={retry}
              style={{
                padding: '6px 14px',
                borderRadius: 4,
                border: 0,
                background: '#0f6cbd',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '6px 14px',
                borderRadius: 4,
                border: '1px solid #d1d1d1',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Reload the page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
