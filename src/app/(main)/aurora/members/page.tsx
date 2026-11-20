import type { Metadata } from 'next';
import { MembersPage } from '@/aurora/components/pages/MembersPage';

export default function () {
  return <MembersPage />;
}

export const metadata: Metadata = {
  title: 'Miembros',
};
