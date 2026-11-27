import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isSlug } from '@/server/share/records';
import { sharedPreview } from '@/server/share/lookup';
import { BASE_OPEN_GRAPH } from '@/server/site';
import WorkspaceLoader from '../WorkspaceLoader';
import { BootHint } from '@/platform/boot-screen';

type Props = { params: Promise<{ slug: string }> };

// A link preview shows the app's name, icon and a one-line description, nothing more (src/server/share/preview.ts).
// Shared apps stay out of search results: they are for whoever was sent the link.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const preview = await sharedPreview(slug);
  const robots = { index: false, follow: false };
  if (!preview) return { title: 'Shared app · Turnkey', robots };
  const url = '/' + slug;
  return {
    title: { absolute: preview.name },
    description: preview.description,
    robots,
    alternates: { canonical: url },
    openGraph: { ...BASE_OPEN_GRAPH, url, title: preview.name, description: preview.description },
    twitter: { card: 'summary_large_image', title: preview.name, description: preview.description },
  };
}

// /<short name>: the workspace, which reads the name from the address and opens the app shared under it
// (see openShared in src/workspace/share.tsx). Anything that cannot be a short name is a plain 404.
export default async function SharedAppPage({ params }: Props) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  return (
    <div id="root">
      <BootHint />
      <WorkspaceLoader />
    </div>
  );
}
