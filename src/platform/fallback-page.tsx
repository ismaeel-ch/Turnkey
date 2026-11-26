import type { CSSProperties, ReactNode } from 'react';

/*
 * A whole-page message for Next's error and not-found screens, drawn like Fluent's message bar from the Fluent 2
 * tokens in src/styles/fluent-theme.css (light and dark follow the system). It uses no component library on purpose:
 * Next loads these screens with the page, before the workspace, so importing Fluent's components here would add
 * about 100 KB to the first download (scripts/check-bundle.mjs guards it).
 */

type Action = { label: string; primary?: boolean } & ({ href: string } | { onClick: () => void });

const TONE = {
  error: {
    bg: 'var(--colorStatusDangerBackground1)',
    line: 'var(--colorStatusDangerBorder1)',
    mark: 'var(--colorStatusDangerForeground1)',
  },
  info: { bg: 'var(--colorNeutralBackground3)', line: 'var(--colorNeutralStroke1)', mark: 'var(--colorBrandForeground1)' },
} as const;

const button = (primary?: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 32,
  padding: '5px 12px',
  borderRadius: 4,
  font: 'inherit',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
  border: primary ? '1px solid transparent' : '1px solid var(--colorNeutralStroke1)',
  background: primary ? 'var(--colorBrandBackground)' : 'var(--colorNeutralBackground1)',
  color: primary ? 'var(--colorNeutralForegroundOnBrand)' : 'var(--colorNeutralForeground1)',
});

export function FallbackPage({
  intent,
  title,
  children,
  actions,
}: {
  intent: 'error' | 'info';
  title: string;
  children: ReactNode;
  actions: Action[];
}) {
  const t = TONE[intent];
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--colorNeutralBackground2)',
        color: 'var(--colorNeutralForeground1)',
        fontFamily: 'var(--fontFamilyBase)',
        fontSize: 14,
        lineHeight: '20px',
      }}
    >
      <main style={{ maxWidth: 560, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          role={intent === 'error' ? 'alert' : 'status'}
          style={{
            background: t.bg,
            border: '1px solid ' + t.line,
            borderLeft: '4px solid ' + t.mark,
            borderRadius: 4,
            padding: '12px 16px',
          }}
        >
          <h1 style={{ fontSize: 16, lineHeight: '22px', fontWeight: 600, margin: '0 0 4px' }}>{title}</h1>
          <p style={{ margin: 0 }}>{children}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {actions.map((a) =>
            'href' in a ? (
              <a key={a.label} href={a.href} style={button(a.primary)}>
                {a.label}
              </a>
            ) : (
              <button key={a.label} type="button" onClick={a.onClick} style={button(a.primary)}>
                {a.label}
              </button>
            ),
          )}
        </div>
      </main>
    </div>
  );
}
