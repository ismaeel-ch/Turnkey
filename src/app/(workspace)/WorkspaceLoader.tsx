'use client';

import dynamic from 'next/dynamic';
import { BootScreen } from '@/platform/boot-screen';

// The workspace keeps its state in browser storage and runs SQLite in the browser, so it renders on the client only.
const Workspace = dynamic(() => import('@/workspace/Workspace'), {
  ssr: false,
  loading: () => <BootScreen />,
});

export default function WorkspaceLoader() {
  return <Workspace />;
}
