import { renderCard, CARD_SIZE } from '@/server/og/card';
import { SITE_DESCRIPTION, siteUrl } from '@/server/site';

// The preview picture for Turnkey's own pages. Built once, at build time.
export const alt = 'Turnkey: describe an app and a team of agents builds it';
export const size = CARD_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderCard({
    title: 'Turnkey',
    description: SITE_DESCRIPTION,
    host: siteUrl().host,
  });
}
