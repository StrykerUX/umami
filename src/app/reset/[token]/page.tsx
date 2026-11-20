import type { Metadata } from 'next';
import { ResetPage } from '@/aurora/components/pages/ResetPage';

export const dynamic = 'force-dynamic';

export default async function ({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return <ResetPage token={token} />;
}

export const metadata: Metadata = {
  title: 'Nueva contraseña',
  robots: { index: false, follow: false },
};
