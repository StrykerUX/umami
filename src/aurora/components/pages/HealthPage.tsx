'use client';
import { Button, Column, Row, Text } from '@umami/react-zen';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { formatDate } from '../format';
import { useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { AURORA_COLORS, EmptyState } from '../ui';

const STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  degraded: 'Degradado',
  down: 'Caído',
};

const STATUS_COLORS: Record<string, string> = {
  ok: AURORA_COLORS.up,
  degraded: '#d97706',
  down: AURORA_COLORS.down,
};

export function HealthDot({ status }: { status: string }) {
  return (
    <Row alignItems="center" gap="2">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          display: 'inline-block',
          background: STATUS_COLORS[status] ?? AURORA_COLORS.muted,
        }}
      />
      <Text>{STATUS_LABELS[status] ?? status}</Text>
    </Row>
  );
}

export function HealthPage() {
  const { data: me } = useAuroraMe();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading, error } = useAuroraQuery(
    'health',
    '/aurora/health/details',
    {},
    isAdmin,
  );
  const { refresh } = useAuroraActions();

  if (me && !isAdmin) {
    return (
      <PageBody>
        <PageHeader title="Health" />
        <EmptyState title="Solo administradores" description="Pide acceso a un admin." />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <PageHeader title="Health">
        <Button onPress={() => refresh('health')}>Actualizar</Button>
      </PageHeader>
      <LoadingPanel data={data} isLoading={isLoading} error={error}>
        {data && (
          <Column gap="4">
            <Panel>
              <Row gap="6" alignItems="center" wrap="wrap" data-test="health-overall">
                <Column gap="1">
                  <Text color="muted">Estado general</Text>
                  <HealthDot status={data.status} />
                </Column>
                {data.version?.commit && (
                  <Column gap="1">
                    <Text color="muted">Commit</Text>
                    <Text>{data.version.commit}</Text>
                  </Column>
                )}
                {data.version?.deployedAt && (
                  <Column gap="1">
                    <Text color="muted">En línea desde</Text>
                    <Text>{formatDate(data.version.deployedAt)}</Text>
                  </Column>
                )}
              </Row>
            </Panel>
            <Panel>
              <SimpleTable
                testId="health-checks"
                columns={[
                  { key: 'label', label: 'Revisión' },
                  { key: 'status', label: 'Estado', width: 140 },
                  { key: 'detail', label: 'Detalle' },
                  { key: 'latency', label: 'Latencia', align: 'right', width: 100 },
                ]}
                rows={data.checks.map((c: any) => ({
                  key: c.key,
                  cells: {
                    label: c.label,
                    status: <HealthDot status={c.status} />,
                    detail: c.detail ?? '—',
                    latency: c.latencyMs != null ? `${c.latencyMs} ms` : '—',
                  },
                }))}
              />
            </Panel>
            <Text color="muted" size="sm">
              Aurora Status consulta /api/aurora/health con el token AURORA_HEALTH_TOKEN.
            </Text>
          </Column>
        )}
      </LoadingPanel>
    </PageBody>
  );
}
