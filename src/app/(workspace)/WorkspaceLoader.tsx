'use client';

import dynamic from 'next/dynamic';

// The workspace keeps its state in browser storage and runs SQLite in the browser, so it renders on the client only.
const Workspace = dynamic(() => import('@/workspace/Workspace'), {
  ssr: false,
  loading: () => (
    <div id="boot">
      <strong>Turnkey</strong>
      <span>Loading</span>
    </div>
  ),
});

export default function WorkspaceLoader() {
  return <Workspace />;
}
