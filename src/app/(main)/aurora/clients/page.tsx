import type { Metadata } from 'next';
import { ClientsPage } from '@/aurora/components/pages/ClientsPage';

export default function () {
  return <ClientsPage />;
}

export const metadata: Metadata = {
  title: 'Clientes',
};
