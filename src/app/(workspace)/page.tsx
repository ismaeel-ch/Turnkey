import type { Metadata } from 'next';
import { BASE_OPEN_GRAPH } from '@/server/site';
import WorkspaceLoader from './WorkspaceLoader';
import { BootHint } from '@/platform/boot-screen';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { ...BASE_OPEN_GRAPH, url: '/' },
};

export default function Page() {
  return (
    <div id="root">
      <BootHint />
      <WorkspaceLoader />
    </div>
  );
}
