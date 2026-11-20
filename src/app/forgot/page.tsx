import type { Metadata } from 'next';
import { ForgotPage } from '@/aurora/components/pages/ForgotPage';

export default function () {
  return <ForgotPage />;
}

export const metadata: Metadata = {
  title: 'Recuperar contraseña',
};
