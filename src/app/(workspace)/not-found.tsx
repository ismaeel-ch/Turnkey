import type { Metadata } from 'next';
import { FallbackPage } from '@/platform/fallback-page';

export const metadata: Metadata = { title: 'Not found · Turnkey' };

/** An address that is not a page and not the short name of a shared app. */
export default function NotFound() {
  return (
    <FallbackPage intent="info" title="Nothing is here" actions={[{ label: 'Go to the workspace', href: '/', primary: true }]}>
      This address is not a page of Turnkey, and no app is shared under it. Check the link, or ask the person who sent it for a new one.
    </FallbackPage>
  );
}
