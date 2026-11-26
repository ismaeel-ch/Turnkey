import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The workspace mounts its own React root from an effect; a double-invoked effect in development would start it twice.
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      // Static files written by scripts/build-legacy.mjs. Their names or query strings change with their content.
      { source: '/vendor/:path*', headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
