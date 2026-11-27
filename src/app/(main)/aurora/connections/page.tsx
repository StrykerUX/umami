import type { Metadata } from 'next';
import { ConnectionsPage } from '@/aurora/components/pages/ConnectionsPage';

export default function () {
  return <ConnectionsPage />;
}

export const metadata: Metadata = {
  title: 'Conexiones',
};
