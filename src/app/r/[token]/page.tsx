import type { Metadata } from 'next';
import { PublicReportPage } from '@/aurora/components/pages/PublicReportPage';

export const dynamic = 'force-dynamic';

export default async function ({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return <PublicReportPage token={token} />;
}

export const metadata: Metadata = {
  title: 'Reporte',
  robots: { index: false, follow: false },
};
