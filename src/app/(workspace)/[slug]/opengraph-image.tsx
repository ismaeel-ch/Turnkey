import { renderCard, CARD_SIZE } from '@/server/og/card';
import { sharedPreview } from '@/server/share/lookup';
import { SITE_DESCRIPTION, siteUrl } from '@/server/site';

// The preview picture for a shared app's short link: its icon, name and one-line description.
export const alt = 'A shared app made with Turnkey';
export const size = CARD_SIZE;
export const contentType = 'image/png';
// Drawn on request, then kept for ten minutes, so a busy link costs one store read per ten minutes, not one per view.
export const revalidate = 600;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const preview = await sharedPreview(slug);
  const host = siteUrl().host;
  if (!preview) return renderCard({ title: 'Turnkey', description: SITE_DESCRIPTION, host });
  return renderCard({ kicker: 'Shared app', title: preview.name, description: preview.description, icon: preview.icon, host });
}
