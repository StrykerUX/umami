'use client';
import { Button, Column, Row, Text } from '@umami/react-zen';
import { useState } from 'react';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { formatDate } from '../format';
import { useAuroraQuery } from '../hooks';
import { ReportView } from '../ReportView';
import { SimpleTable } from '../table';
import { EmptyState } from '../ui';

export function ReportDetailPage({ reportId }: { reportId: string }) {
  const { data: schedule } = useAuroraQuery(`report:${reportId}`, `/aurora/reports/${reportId}`);
  const { data: runs } = useAuroraQuery(`runs:${reportId}`, `/aurora/reports/${reportId}/runs`);
  const [runId, setRunId] = useState<string>('');
  const selected = runId || runs?.data?.[0]?.id || '';
  const { data: run } = useAuroraQuery(
    `run:${selected}`,
    `/aurora/reports/runs/${selected}`,
    {},
    !!selected,
  );

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title={schedule?.name ?? 'Reporte'}
          description="Historial de ejecuciones. Cada una guarda sus números tal como se enviaron."
        />
        <Panel title="Historial">
          {runs?.data?.length ? (
            <SimpleTable
              columns={[
                { key: 'period', label: 'Periodo' },
                { key: 'status', label: 'Estado' },
                { key: 'sent', label: 'Enviado a' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={runs.data.map((r: any) => ({
                key: r.id,
                cells: {
                  period: `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`,
                  status: r.status + (r.error ? ` (${r.error})` : ''),
                  sent: r.sentTo?.length ? r.sentTo.join(', ') : '—',
                  actions: (
                    <Button
                      size="sm"
                      variant={r.id === selected ? 'primary' : undefined}
                      onPress={() => setRunId(r.id)}
                    >
                      Ver
                    </Button>
                  ),
                },
              }))}
            />
          ) : (
            <EmptyState
              title="Aún no hay ejecuciones"
              description="Usa “Vista previa” o espera al próximo envío."
            />
          )}
        </Panel>
        {run?.snapshot?.version && (
          <Column gap="3">
            <Row justifyContent="flex-end">
              <Text size="sm">
                Link público:{' '}
                <a href={run.shareUrl} target="_blank" rel="noopener noreferrer">
                  abrir
                </a>
              </Text>
            </Row>
            <ReportView snapshot={run.snapshot} />
          </Column>
        )}
      </Column>
    </PageBody>
  );
}
