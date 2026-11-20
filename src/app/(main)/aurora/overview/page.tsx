import type { Metadata } from 'next';
import { OverviewPage } from '@/aurora/components/pages/OverviewPage';

export default function () {
  return <OverviewPage />;
}

export const metadata: Metadata = {
  title: 'Overview',
};
