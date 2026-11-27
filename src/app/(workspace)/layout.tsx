import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/base.css';
import '@/styles/fluent-theme.css';
import '@/styles/workspace.css';
import '@/styles/agents.css';
import '@/styles/motion.css';
import PwaRegister from '@/platform/pwa/PwaRegister';
import { BASE_OPEN_GRAPH, SITE_DESCRIPTION, SITE_NAME, siteUrl } from '@/server/site';

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Link previews. The picture comes from opengraph-image.tsx beside this file (and beside [slug]/page.tsx for a
  // shared app); X reads og:image when there is no twitter:image.
  openGraph: { ...BASE_OPEN_GRAPH },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_DESCRIPTION },
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
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
