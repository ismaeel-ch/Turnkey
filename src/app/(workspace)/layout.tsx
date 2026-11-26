import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import assets from '@/platform/generated/assets.json';
import PwaRegister from '@/platform/pwa/PwaRegister';

export const metadata: Metadata = {
  title: 'Turnkey',
  description:
    'Describe the app your work needs. A team of agents builds its database, backend, views, pages and tests on a workflow you can watch and change.',
  applicationName: 'Turnkey',
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f5f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1f1f1f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* The workspace stylesheet is a static file written by scripts/build-legacy.mjs, served byte for byte. */}
        <link rel="stylesheet" href={assets.css} precedence="default" />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
