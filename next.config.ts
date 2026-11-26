import type { NextConfig } from 'next';

// CopilotKit's runtime reports anonymous usage unless told not to. Set here for the build, and in
// src/instrumentation.ts for the running server. This project sends nothing to third parties.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= 'true';

const nextConfig: NextConfig = {
  // The workspace starts once per page (Workspace.tsx guards it); strict mode's double render is not needed here.
  reactStrictMode: false,
  poweredByHeader: false,
  async headers() {
    return [
      // The SQLite engine copied by scripts/copy-sqlite.mjs; its URL carries the sql.js version.
      { source: '/vendor/:path*', headers: [{ key: 'cache-control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
