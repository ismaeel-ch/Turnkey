import type { MetadataRoute } from 'next';

// Turnkey itself. An app built in Turnkey installs from /a/manifest instead (see src/app/a/manifest/route.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Turnkey',
    short_name: 'Turnkey',
    lang: 'en',
    dir: 'ltr',
    description:
      'Describe the app your work needs. A team of agents builds its database, backend, views, pages and tests on a workflow you can watch and change.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    // One colour pair: the manifest cannot switch with the system theme. The page's own theme-color meta tags do.
    background_color: '#1f1f1f',
    theme_color: '#1f1f1f',
    categories: ['productivity', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
