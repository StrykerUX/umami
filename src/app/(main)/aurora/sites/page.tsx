import type { Metadata } from 'next';
import { SitesPage } from '@/aurora/components/pages/SitesPage';

export default function () {
  return <SitesPage />;
}

export const metadata: Metadata = {
  title: 'Clasificación de sitios',
};
