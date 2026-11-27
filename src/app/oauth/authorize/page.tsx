import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OAuthConsentPage } from '@/aurora/components/pages/OAuthConsentPage';

export const dynamic = 'force-dynamic';

/** AURORA: OAuth consent screen for MCP connectors (claude.ai). */
export default function () {
  return (
    <Suspense>
      <OAuthConsentPage />
    </Suspense>
  );
}

export const metadata: Metadata = {
  title: 'Conectar aplicación',
  robots: { index: false, follow: false },
};
