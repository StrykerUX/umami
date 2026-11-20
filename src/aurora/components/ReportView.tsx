'use client';
import { Column, Grid, Heading, Row, Text } from '@umami/react-zen';
import type { ReportSnapshot, TopRow } from '../lib/report';
import { FREQUENCY_LABELS, formatDuration, formatNumber } from './format';
import { Delta, StatCard } from './ui';

function TopTable({ title, rows }: { title: string; rows?: TopRow[] }) {
  if (!rows?.length) return null;

  return (
    <Column gap="2">
      <Text weight="bold" size="sm">
        {title}
      </Text>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.x} style={{ borderBottom: '1px solid var(--border-color, #e6e8ef)' }}>
              <td style={{ padding: '6px 0', wordBreak: 'break-all' }}>{r.x}</td>
              <td style={{ textAlign: 'right', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                {formatNumber(r.y)}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <Delta value={r.delta} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Column>
  );
}

export function ReportView({ snapshot }: { snapshot: ReportSnapshot }) {
  const { totals } = snapshot;

  return (
    <Column gap="6" data-test="report-view">
      <Column gap="1">
        <Heading size="lg">{snapshot.name}</Heading>
        <Text color="muted">
          {FREQUENCY_LABELS[snapshot.frequency]} · {snapshot.scope.name} · {snapshot.period.label}
        </Text>
        <Text color="muted" size="sm">
          Comparado con {snapshot.previous.label}
        </Text>
      </Column>

      {snapshot.sections.kpis && (
        <Grid columns={{ base: '1fr 1fr', md: 'repeat(5, 1fr)' }} gap="3">
          <StatCard
            label="Visitantes"
            value={formatNumber(totals.current.visitors)}
            delta={<Delta value={totals.delta.visitors} />}
          />
          <StatCard
            label="Visitas"
            value={formatNumber(totals.current.visits)}
            delta={<Delta value={totals.delta.visits} />}
          />
          <StatCard
            label="Páginas vistas"
            value={formatNumber(totals.current.pageviews)}
            delta={<Delta value={totals.delta.pageviews} />}
          />
          <StatCard
            label="Rebote"
            value={`${totals.current.bounceRate}%`}
            delta={<Delta value={totals.delta.bounceRate} inverse points />}
          />
          <StatCard
            label="Duración media"
            value={formatDuration(totals.current.avgDuration)}
            delta={<Delta value={totals.delta.avgDuration} />}
          />
        </Grid>
      )}

      {snapshot.highlights.length > 0 && (
        <Column border borderRadius padding="4" gap="2" backgroundColor="surface">
          <Text weight="bold">Lo destacado</Text>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {snapshot.highlights.map(h => (
              <li key={h}>
                <Text>{h}</Text>
              </li>
            ))}
          </ul>
        </Column>
      )}

      {snapshot.websites.map(w => (
        <Column key={w.id} border borderRadius padding="4" gap="4" backgroundColor="surface">
          <Row justifyContent="space-between" alignItems="center" wrap="wrap" gap="2">
            <Column>
              <Text weight="bold" size="lg">
                {w.name}
              </Text>
              <Text color="muted" size="sm">
                {w.domain}
              </Text>
            </Column>
            {w.uptime && w.uptime.pct !== null && (
              <Text size="sm">
                Uptime <b>{w.uptime.pct}%</b>
                {w.uptime.incidents ? ` · ${w.uptime.incidents} incidente(s)` : ''}
              </Text>
            )}
          </Row>
          <Row gap="6" wrap="wrap">
            <Text size="sm">
              Visitantes <b>{formatNumber(w.current.visitors)}</b>{' '}
              <Delta value={w.delta.visitors} />
            </Text>
            <Text size="sm">
              Vistas <b>{formatNumber(w.current.pageviews)}</b> <Delta value={w.delta.pageviews} />
            </Text>
            <Text size="sm">
              Rebote <b>{w.current.bounceRate}%</b>{' '}
              <Delta value={w.delta.bounceRate} inverse points />
            </Text>
            <Text size="sm">
              Duración <b>{formatDuration(w.current.avgDuration)}</b>{' '}
              <Delta value={w.delta.avgDuration} />
            </Text>
          </Row>
          <Grid columns={{ base: '1fr', lg: 'repeat(3, 1fr)' }} gap="6">
            <TopTable title="Páginas principales" rows={w.topPages} />
            <TopTable title="Fuentes de tráfico" rows={w.referrers} />
            <TopTable title="Países" rows={w.countries} />
          </Grid>
        </Column>
      ))}

      {!snapshot.websites.length && (
        <Text color="muted">Este reporte no tiene sitios asignados.</Text>
      )}
    </Column>
  );
}
