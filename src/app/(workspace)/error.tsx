'use client';

import { useEffect } from 'react';
import { FallbackPage } from '@/platform/fallback-page';

/** Shown when the page itself fails to render. The workspace's own areas have their own boundaries inside. */
export default function WorkspaceError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error('[turnkey] the page could not render', error);
  }, [error]);
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <FallbackPage
      intent="error"
      title="This page could not be shown"
      actions={[
        { label: 'Try again', primary: true, onClick: retry },
        { label: 'Go to the workspace', href: '/' },
      ]}
    >
      Your apps and their data are saved in this browser and were not changed.
      {digest ? ` If it keeps happening, mention error ${digest}.` : ''}
    </FallbackPage>
  );
}
