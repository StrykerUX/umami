import type { Metadata } from 'next';
import { UptimePage } from '@/aurora/components/pages/UptimePage';

export default function () {
  return <UptimePage />;
}

export const metadata: Metadata = {
  title: 'Uptime',
};
