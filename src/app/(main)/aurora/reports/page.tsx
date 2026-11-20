import type { Metadata } from 'next';
import { ReportsPage } from '@/aurora/components/pages/ReportsPage';

export default function () {
  return <ReportsPage />;
}

export const metadata: Metadata = {
  title: 'Reportes',
};
