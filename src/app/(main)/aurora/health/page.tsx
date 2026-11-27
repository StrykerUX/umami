import type { Metadata } from 'next';
import { HealthPage } from '@/aurora/components/pages/HealthPage';

export default function () {
  return <HealthPage />;
}

export const metadata: Metadata = {
  title: 'Health',
};
