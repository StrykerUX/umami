import type { Metadata } from 'next';
import { ReportDetailPage } from '@/aurora/components/pages/ReportDetailPage';

export const dynamic = 'force-dynamic';

export default async function ({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;

  return <ReportDetailPage reportId={reportId} />;
}

export const metadata: Metadata = {
  title: 'Reporte',
  robots: { index: false, follow: false },
};
