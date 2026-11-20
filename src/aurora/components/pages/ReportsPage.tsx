'use client';
import { Button, Column, Grid, Row, Switch, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import Link from '@/components/common/Link';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { useNavigation } from '@/components/hooks';
import { FREQUENCY_LABELS, formatDate, isEmail, parseEmails, SCOPE_LABELS } from '../format';
import { canEdit, useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText, Field, NativeSelect } from '../ui';

const SECTION_LABELS: Record<string, string> = {
  kpis: 'KPIs',
  topPages: 'Páginas principales',
  referrers: 'Fuentes de tráfico',
  countries: 'Países',
  uptime: 'Uptime',
};

const TIMEZONES = [
  'America/Mexico_City',
  'America/Monterrey',
  'America/Cancun',
  'America/Tijuana',
  'America/Bogota',
  'America/New_York',
  'Europe/Madrid',
  'UTC',
];

const emptyForm = {
  id: '',
  name: '',
  scope: 'all',
  scopeId: '',
  frequency: 'weekly',
  recipients: '',
  includeClientContacts: true,
  timezone: 'America/Mexico_City',
  sections: {
    kpis: true,
    topPages: true,
    referrers: true,
    countries: true,
    uptime: true,
  } as Record<string, boolean>,
};

export function ReportsPage() {
  const { renderUrl } = useNavigation();
  const { data: me } = useAuroraMe();
  const editable = canEdit(me?.role);
  const { data, isLoading } = useAuroraQuery('reports', '/aurora/reports');
  const { data: workspaces } = useAuroraQuery('workspaces', '/aurora/workspaces');
  const { data: clients } = useAuroraQuery('clients', '/aurora/clients');
  const { data: websites } = useAuroraQuery('websites', '/aurora/websites');
  const { post, patch, del, refresh } = useAuroraActions();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<any>(null);
  const [notice, setNotice] = useState<string>('');

  const scopeOptions: Record<string, { value: string; label: string }[]> = {
    workspace: (workspaces?.data ?? []).map((w: any) => ({ value: w.id, label: w.name })),
    client: (clients?.data ?? []).map((c: any) => ({ value: c.id, label: c.name })),
    website: (websites?.data ?? []).map((w: any) => ({ value: w.id, label: w.name })),
  };
  const scopeName = (scope: string, id: string | null) =>
    scope === 'all'
      ? SCOPE_LABELS.all
      : (scopeOptions[scope]?.find(o => o.value === id)?.label ?? '—');

  const submit = async () => {
    setError(null);
    setNotice('');
    const recipients = parseEmails(form.recipients);
    const bad = recipients.find(e => !isEmail(e));
    if (bad) {
      setError(`Email inválido: ${bad}`);
      return;
    }
    const body = {
      name: form.name,
      scope: form.scope,
      scopeId: form.scope === 'all' ? null : form.scopeId || null,
      frequency: form.frequency,
      recipients,
      includeClientContacts: form.includeClientContacts,
      timezone: form.timezone,
      sections: form.sections,
    };
    try {
      if (form.id) await patch(`/aurora/reports/${form.id}`, body);
      else await post('/aurora/reports', body);
      setForm(emptyForm);
      refresh('reports');
    } catch (e) {
      setError(e);
    }
  };

  const run = async (id: string, send: boolean) => {
    setError(null);
    setNotice('');
    try {
      const result = await post(`/aurora/reports/${id}/run`, { send });
      setNotice(
        send
          ? result.sentTo?.length
            ? `Enviado a ${result.sentTo.join(', ')}.`
            : `Reporte generado (${result.status}); sin destinatarios.`
          : 'Vista previa generada.',
      );
      refresh('reports', `runs:${id}`);
      if (!send && result.url) window.open(result.url, '_blank', 'noopener');
    } catch (e) {
      setError(e);
    }
  };

  const rows: any[] = data?.data ?? [];

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Reportes programados"
          description="Semanal, quincenal (1–15 / 16–fin), mensual o bimestral, siempre comparando contra el periodo anterior. Se envían a las 8:00 del día en que cierra el periodo."
        />
        {notice && <Text data-test="report-notice">{notice}</Text>}
        <ErrorText error={error} />

        {editable && (
          <Panel title={form.id ? 'Editar reporte' : 'Nuevo reporte'}>
            <Column gap="3">
              <Grid columns={{ base: '1fr', md: '1fr 1fr 1fr' }} gap="3">
                <Field label="Nombre">
                  <TextField
                    data-test="report-name"
                    value={form.name}
                    onChange={v => setForm(f => ({ ...f, name: v }))}
                  />
                </Field>
                <Field label="Frecuencia">
                  <NativeSelect
                    testId="report-frequency"
                    value={form.frequency}
                    onChange={v => setForm(f => ({ ...f, frequency: v }))}
                    options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </Field>
                <Field label="Zona horaria">
                  <NativeSelect
                    value={form.timezone}
                    onChange={v => setForm(f => ({ ...f, timezone: v }))}
                    options={TIMEZONES.map(t => ({ value: t, label: t }))}
                  />
                </Field>
                <Field label="Aplica a">
                  <NativeSelect
                    testId="report-scope"
                    value={form.scope}
                    onChange={v => setForm(f => ({ ...f, scope: v, scopeId: '' }))}
                    options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </Field>
                {form.scope !== 'all' && (
                  <Field label={SCOPE_LABELS[form.scope as keyof typeof SCOPE_LABELS]}>
                    <NativeSelect
                      testId="report-scope-id"
                      value={form.scopeId}
                      placeholder="Selecciona…"
                      onChange={v => setForm(f => ({ ...f, scopeId: v }))}
                      options={scopeOptions[form.scope] ?? []}
                    />
                  </Field>
                )}
              </Grid>
              <Field
                label="Destinatarios"
                hint="Separados por coma. Se suman los contactos del cliente si está activado abajo."
              >
                <TextField
                  data-test="report-recipients"
                  value={form.recipients}
                  onChange={v => setForm(f => ({ ...f, recipients: v }))}
                  placeholder="equipo@aurora33.org"
                />
              </Field>
              <Switch
                isSelected={form.includeClientContacts}
                onChange={(v: boolean) => setForm(f => ({ ...f, includeClientContacts: v }))}
              >
                Incluir a los contactos del cliente
              </Switch>
              <Row gap="4" wrap="wrap">
                {Object.keys(SECTION_LABELS).map(key => (
                  <label
                    key={key}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}
                  >
                    <input
                      type="checkbox"
                      checked={!!form.sections[key]}
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          sections: { ...f.sections, [key]: e.target.checked },
                        }))
                      }
                    />
                    {SECTION_LABELS[key]}
                  </label>
                ))}
              </Row>
              <Row gap="2">
                <Button
                  data-test="report-save"
                  variant="primary"
                  isDisabled={!form.name.trim() || (form.scope !== 'all' && !form.scopeId)}
                  onPress={submit}
                >
                  {form.id ? 'Guardar cambios' : 'Crear reporte'}
                </Button>
                {form.id && <Button onPress={() => setForm(emptyForm)}>Cancelar</Button>}
              </Row>
            </Column>
          </Panel>
        )}

        <Panel title="Reportes">
          {rows.length ? (
            <SimpleTable
              testId="reports-table"
              columns={[
                { key: 'name', label: 'Reporte' },
                { key: 'freq', label: 'Frecuencia' },
                { key: 'scope', label: 'Aplica a' },
                { key: 'next', label: 'Próximo envío' },
                { key: 'last', label: 'Último' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={rows.map(r => ({
                key: r.id,
                cells: {
                  name: (
                    <Link href={renderUrl(`/aurora/reports/${r.id}`, false)}>
                      <Text weight="bold">{r.name}</Text>
                      {!r.active && <Text color="muted"> (pausado)</Text>}
                    </Link>
                  ),
                  freq: FREQUENCY_LABELS[r.frequency as keyof typeof FREQUENCY_LABELS],
                  scope: `${SCOPE_LABELS[r.scope as keyof typeof SCOPE_LABELS]}: ${scopeName(r.scope, r.scopeId)}`,
                  next: formatDate(r.nextRunAt, true),
                  last: r.runs?.[0]
                    ? `${formatDate(r.runs[0].createdAt, true)} · ${r.runs[0].status}`
                    : '—',
                  actions: (
                    <Row gap="1" justifyContent="flex-end" wrap="wrap">
                      <Button size="sm" data-test="report-preview" onPress={() => run(r.id, false)}>
                        Vista previa
                      </Button>
                      {editable && (
                        <>
                          <Button size="sm" data-test="report-send" onPress={() => run(r.id, true)}>
                            Enviar ahora
                          </Button>
                          <Button
                            size="sm"
                            onPress={() =>
                              setForm({
                                id: r.id,
                                name: r.name,
                                scope: r.scope,
                                scopeId: r.scopeId ?? '',
                                frequency: r.frequency,
                                recipients: r.recipients.join(', '),
                                includeClientContacts: r.includeClientContacts,
                                timezone: r.timezone,
                                sections: { ...emptyForm.sections, ...(r.sections ?? {}) },
                              })
                            }
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            onPress={async () => {
                              await patch(`/aurora/reports/${r.id}`, {
                                ...r,
                                scopeId: r.scopeId,
                                active: !r.active,
                              });
                              refresh('reports');
                            }}
                          >
                            {r.active ? 'Pausar' : 'Activar'}
                          </Button>
                          <Button
                            size="sm"
                            variant="quiet"
                            onPress={async () => {
                              await del(`/aurora/reports/${r.id}`);
                              refresh('reports');
                            }}
                          >
                            Eliminar
                          </Button>
                        </>
                      )}
                    </Row>
                  ),
                },
              }))}
            />
          ) : (
            <EmptyState
              title={isLoading ? 'Cargando…' : 'Sin reportes'}
              description="Crea un reporte para enviarlo automáticamente."
            />
          )}
        </Panel>
      </Column>
    </PageBody>
  );
}
