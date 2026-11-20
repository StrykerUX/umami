'use client';
import { Button, Column, Row, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { formatDate, isEmail, parseEmails } from '../format';
import { canEdit, useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText, Field, StatusDot } from '../ui';

function MonitorEditor({ site, onDone }: { site: any; onDone: () => void }) {
  const { put, del, refresh } = useAuroraActions();
  const m = site.monitor;
  const [url, setUrl] = useState(m?.url ?? (site.domain ? `https://${site.domain}` : 'https://'));
  const [keyword, setKeyword] = useState(m?.keyword ?? '');
  const [emails, setEmails] = useState((m?.alertEmails ?? []).join(', '));
  const [error, setError] = useState<any>(null);

  const save = async (enabled = true) => {
    setError(null);
    const alertEmails = parseEmails(emails);
    const bad = alertEmails.find(e => !isEmail(e));
    if (bad) return setError(`Email inválido: ${bad}`);
    try {
      await put(`/aurora/uptime/${site.id}`, {
        url,
        keyword: keyword || null,
        alertEmails,
        enabled,
      });
      refresh('uptime', 'websites', 'overview');
      onDone();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Column gap="3" padding="3" border borderRadius>
      <Field label="URL a revisar">
        <TextField data-test="monitor-url" value={url} onChange={setUrl} />
      </Field>
      <Field
        label="Texto que debe aparecer (opcional)"
        hint="Si la página no lo contiene, cuenta como caída."
      >
        <TextField value={keyword} onChange={setKeyword} />
      </Field>
      <Field label="Alertas por email">
        <TextField
          data-test="monitor-emails"
          value={emails}
          onChange={setEmails}
          placeholder="ops@aurora33.org"
        />
      </Field>
      <ErrorText error={error} />
      <Row gap="2">
        <Button data-test="monitor-save" variant="primary" onPress={() => save(true)}>
          Guardar
        </Button>
        {m && <Button onPress={() => save(!m.enabled)}>{m.enabled ? 'Pausar' : 'Reanudar'}</Button>}
        {m && (
          <Button
            variant="quiet"
            onPress={async () => {
              await del(`/aurora/uptime/${site.id}`);
              refresh('uptime', 'websites');
              onDone();
            }}
          >
            Quitar monitor
          </Button>
        )}
        <Button variant="quiet" onPress={onDone}>
          Cerrar
        </Button>
      </Row>
    </Column>
  );
}

export function UptimePage() {
  const { data: me } = useAuroraMe();
  const editable = canEdit(me?.role);
  const { data, isLoading, error } = useAuroraQuery('uptime', '/aurora/uptime');
  const [editing, setEditing] = useState('');
  const rows: any[] = data?.data ?? [];

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Uptime"
          description="Revisión cada minuto desde Cloudflare. Se marca caído tras 2 fallos seguidos; cada caída queda como anotación en la gráfica del sitio."
        />
        <Panel>
          <LoadingPanel
            data={data}
            isLoading={isLoading}
            error={error}
            isEmpty={!rows.length}
            renderEmpty={() => <EmptyState title="Sin sitios" />}
          >
            <Column gap="3">
              <SimpleTable
                testId="uptime-table"
                columns={[
                  { key: 'site', label: 'Sitio' },
                  { key: 'status', label: 'Estado' },
                  { key: 'pct', label: '30 días', align: 'right' },
                  { key: 'latency', label: 'Latencia', align: 'right' },
                  { key: 'last', label: 'Última revisión' },
                  { key: 'incidents', label: 'Incidentes' },
                  { key: 'actions', label: '', align: 'right' },
                ]}
                rows={rows.map(s => ({
                  key: s.id,
                  cells: {
                    site: (
                      <Column>
                        <Text weight="bold">{s.name}</Text>
                        <Text size="sm" color="muted">
                          {s.monitor?.url ?? s.domain}
                        </Text>
                      </Column>
                    ),
                    status: s.monitor ? (
                      s.monitor.enabled ? (
                        <StatusDot status={s.monitor.status} />
                      ) : (
                        <Text color="muted">Pausado</Text>
                      )
                    ) : (
                      <Text color="muted">Sin monitor</Text>
                    ),
                    pct:
                      s.monitor?.uptimePct !== null && s.monitor?.uptimePct !== undefined
                        ? `${s.monitor.uptimePct}%`
                        : '—',
                    latency: s.monitor?.lastLatencyMs ? `${s.monitor.lastLatencyMs} ms` : '—',
                    last: formatDate(s.monitor?.lastCheckedAt, true),
                    incidents: s.monitor?.incidents?.length
                      ? s.monitor.incidents
                          .slice(0, 3)
                          .map(
                            (i: any) =>
                              `${formatDate(i.startedAt, true)}${i.resolvedAt ? '' : ' (abierto)'}`,
                          )
                          .join(' · ')
                      : '—',
                    actions: editable ? (
                      <Button
                        size="sm"
                        data-test="monitor-edit"
                        onPress={() => setEditing(editing === s.id ? '' : s.id)}
                      >
                        {s.monitor ? 'Configurar' : 'Monitorear'}
                      </Button>
                    ) : null,
                  },
                }))}
              />
              {editing && rows.find(r => r.id === editing) && (
                <MonitorEditor
                  site={rows.find(r => r.id === editing)}
                  onDone={() => setEditing('')}
                />
              )}
            </Column>
          </LoadingPanel>
        </Panel>
      </Column>
    </PageBody>
  );
}
