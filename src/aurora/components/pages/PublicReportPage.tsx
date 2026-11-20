'use client';
import { Loading, Text } from '@umami/react-zen';
import { useEffect, useState } from 'react';
import { PublicShell } from '../PublicShell';
import { ReportView } from '../ReportView';
import { publicFetch } from './InvitePage';

export function PublicReportPage({ token }: { token: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    publicFetch(`/aurora/public/reports?token=${encodeURIComponent(token)}`)
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <PublicShell title="Reporte no disponible">
        <Text>{error}</Text>
      </PublicShell>
    );
  }

  if (!data) return <Loading placement="absolute" />;

  return (
    <PublicShell wide>
      <ReportView snapshot={data.snapshot} />
    </PublicShell>
  );
}
