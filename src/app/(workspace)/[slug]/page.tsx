import { notFound } from 'next/navigation';
import { isSlug } from '@/server/share/records';
import WorkspaceLoader from '../WorkspaceLoader';

// /<short name>: the workspace, which reads the name from the address and opens the app shared under it
// (see openShared in src/workspace/share.tsx). Anything that cannot be a short name is a plain 404.
export default async function SharedAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  return (
    <div id="root">
      <WorkspaceLoader />
    </div>
  );
}
