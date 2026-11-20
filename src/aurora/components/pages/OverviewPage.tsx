'use client';
import { Column, Grid, Row, Text } from '@umami/react-zen';
import { useState } from 'react';
import Link from '@/components/common/Link';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { useNavigation } from '@/components/hooks';
import { formatDuration, formatNumber } from '../format';
import { useAuroraQuery } from '../hooks';
import { Delta, EmptyState, NativeSelect, Pill, StatCard, StatusDot } from '../ui';

const RANGES = [
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
  { value: '90', label: 'Últimos 90 días' },
];

export function OverviewPage() {
  const { renderUrl } = useNavigation();
  const [days, setDays] = useState('30');
  const [workspaceId, setWorkspaceId] = useState('');
  const [clientTypeId, setClientTypeId] = useState('');
  const { data: workspaces } = useAuroraQuery('workspaces', '/aurora/workspaces');
  const { data: types } = useAuroraQuery('client-types', '/aurora/client-types');
  const { data: clients } = useAuroraQuery('clients', '/aurora/clients');
  const params = {
    days,
    ...(workspaceId && { workspaceId }),
    ...(clientTypeId && { clientTypeId }),
  };
  const { data, isLoading, error } = useAuroraQuery('overview', '/aurora/overview', params);

  const rows: any[] = data?.data ?? [];
  const clientName = new Map((clients?.data ?? []).map((c: any) => [c.id, c.name]));
  const wsMap = new Map((workspaces?.data ?? []).map((w: any) => [w.id, w]));
  const total = rows.reduce(
    (acc, r) => ({
      visitors: acc.visitors + r.current.visitors,
      prevVisitors: acc.prevVisitors + r.previous.visitors,
      pageviews: acc.pageviews + r.current.pageviews,
      prevPageviews: acc.prevPageviews + r.previous.pageviews,
      down: acc.down + (r.uptime?.status === 'down' ? 1 : 0),
    }),
    { visitors: 0, prevVisitors: 0, pageviews: 0, prevPageviews: 0, down: 0 },
  );
  const pct = (c: number, p: number) => (p ? Math.round(((c - p) / p) * 1000) / 10 : c ? null : 0);

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Overview"
          description="Todos los sitios de la organización, comparados con el periodo anterior."
        >
          <Row gap="2" wrap="wrap">
            <NativeSelect
              testId="overview-range"
              value={days}
              onChange={setDays}
              options={RANGES}
            />
            <NativeSelect
              testId="overview-workspace"
              value={workspaceId}
              onChange={setWorkspaceId}
              placeholder="Todos los workspaces"
              options={(workspaces?.data ?? []).map((w: any) => ({ value: w.id, label: w.name }))}
            />
            <NativeSelect
              testId="overview-client-type"
              value={clientTypeId}
              onChange={setClientTypeId}
              placeholder="Todos los tipos"
              options={(types?.data ?? []).map((t: any) => ({ value: t.id, label: t.name }))}
            />
          </Row>
        </PageHeader>

        <Grid columns={{ base: '1fr 1fr', md: 'repeat(4, 1fr)' }} gap="3">
          <StatCard label="Sitios" value={formatNumber(rows.length)} />
          <StatCard
            label="Visitantes"
            value={formatNumber(total.visitors)}
            delta={<Delta value={pct(total.visitors, total.prevVisitors)} />}
          />
          <StatCard
            label="Páginas vistas"
            value={formatNumber(total.pageviews)}
            delta={<Delta value={pct(total.pageviews, total.prevPageviews)} />}
          />
          <StatCard label="Sitios caídos" value={formatNumber(total.down)} />
        </Grid>

        <LoadingPanel
          data={data}
          isLoading={isLoading}
          error={error}
          isEmpty={!rows.length}
          renderEmpty={() => (
            <EmptyState
              title="Sin sitios"
              description="Agrega un sitio en Sitios web o cambia los filtros."
            />
          )}
        >
          <Grid
            columns={{ base: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' }}
            gap="4"
            data-test="overview-grid"
          >
            {rows
              .slice()
              .sort((a, b) => b.current.visitors - a.current.visitors)
              .map(r => {
                const ws: any = r.workspaceId ? wsMap.get(r.workspaceId) : null;
                return (
                  <Column
                    key={r.id}
                    border
                    borderRadius
                    padding="4"
                    gap="3"
                    backgroundColor="surface"
                  >
                    <Row justifyContent="space-between" alignItems="flex-start" gap="2">
                      <Column gap="1" style={{ minWidth: 0 }}>
                        <Link href={renderUrl(`/websites/${r.id}`, false)}>
                          <Text weight="bold">{r.name}</Text>
                        </Link>
                        <Text size="sm" color="muted" truncate>
                          {r.domain}
                        </Text>
                      </Column>
                      {r.uptime && <StatusDot status={r.uptime.status} />}
                    </Row>
                    <Row gap="2" wrap="wrap">
                      {ws && <Pill color={ws.color}>{ws.name}</Pill>}
                      {r.clientId && (
                        <Pill color="#334155">
                          {String(clientName.get(r.clientId) ?? 'Cliente')}
                        </Pill>
                      )}
                      {r.tags?.map((t: string) => (
                        <Pill key={t} color="#64748b">
                          #{t}
                        </Pill>
                      ))}
                    </Row>
                    <Grid columns="1fr 1fr 1fr" gap="2">
                      <Column>
                        <Text size="xs" color="muted">
                          Visitantes
                        </Text>
                        <Text weight="bold">{formatNumber(r.current.visitors)}</Text>
                        <Delta value={r.delta.visitors} />
                      </Column>
                      <Column>
                        <Text size="xs" color="muted">
                          Vistas
                        </Text>
                        <Text weight="bold">{formatNumber(r.current.pageviews)}</Text>
                        <Delta value={r.delta.pageviews} />
                      </Column>
                      <Column>
                        <Text size="xs" color="muted">
                          Duración
                        </Text>
                        <Text weight="bold">{formatDuration(r.current.avgDuration)}</Text>
                        <Delta value={r.delta.avgDuration} />
                      </Column>
                    </Grid>
                  </Column>
                );
              })}
          </Grid>
        </LoadingPanel>
      </Column>
    </PageBody>
  );
}
