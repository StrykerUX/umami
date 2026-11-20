'use client';
import { Button, Column, Grid, Row, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { isEmail, parseEmails } from '../format';
import { canEdit, useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText, Field, NativeSelect, Pill } from '../ui';

function WorkspacesPanel({ editable, isAdmin }: { editable: boolean; isAdmin: boolean }) {
  const { data } = useAuroraQuery('workspaces', '/aurora/workspaces');
  const { post, del, refresh } = useAuroraActions();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('internal');
  const [color, setColor] = useState('#6d5ef6');
  const [error, setError] = useState<any>(null);

  const create = async () => {
    setError(null);
    try {
      await post('/aurora/workspaces', { name, kind, color });
      setName('');
      refresh('workspaces');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Panel title="Workspaces">
      <Column gap="4">
        {(data?.data ?? []).map((w: any) => (
          <Row key={w.id} justifyContent="space-between" alignItems="center">
            <Row gap="2" alignItems="center">
              <Pill color={w.color}>{w.name}</Pill>
              <Text size="sm" color="muted">
                {w.kind} · {w._count?.clients ?? 0} clientes
              </Text>
            </Row>
            {isAdmin && (
              <Button
                size="sm"
                variant="quiet"
                onPress={async () => {
                  await del(`/aurora/workspaces/${w.id}`);
                  refresh('workspaces', 'clients');
                }}
              >
                Eliminar
              </Button>
            )}
          </Row>
        ))}
        {!data?.data?.length && (
          <Text color="muted">Crea "Internal" y "External" para empezar.</Text>
        )}
        {editable && (
          <Column gap="2">
            <Row gap="2" wrap="wrap" alignItems="flex-end">
              <Field label="Nombre">
                <TextField
                  data-test="ws-name"
                  value={name}
                  onChange={setName}
                  placeholder="Internal"
                />
              </Field>
              <Field label="Tipo">
                <NativeSelect
                  testId="ws-kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'internal', label: 'Internal' },
                    { value: 'external', label: 'External' },
                  ]}
                />
              </Field>
              <Field label="Color">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  style={{ height: 36, width: 48 }}
                />
              </Field>
              <Button
                data-test="ws-create"
                variant="primary"
                isDisabled={!name.trim()}
                onPress={create}
              >
                Agregar
              </Button>
            </Row>
            <ErrorText error={error} />
          </Column>
        )}
      </Column>
    </Panel>
  );
}

function ClientTypesPanel({ editable, isAdmin }: { editable: boolean; isAdmin: boolean }) {
  const { data } = useAuroraQuery('client-types', '/aurora/client-types');
  const { post, del, refresh } = useAuroraActions();
  const [name, setName] = useState('');
  const [error, setError] = useState<any>(null);

  return (
    <Panel title="Tipos de cliente">
      <Column gap="4">
        <Row gap="2" wrap="wrap">
          {(data?.data ?? []).map((t: any) => (
            <Row key={t.id} gap="1" alignItems="center">
              <Pill color="#334155">
                {t.name} ({t._count?.clients ?? 0})
              </Pill>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="quiet"
                  onPress={async () => {
                    await del(`/aurora/client-types/${t.id}`);
                    refresh('client-types', 'clients');
                  }}
                >
                  ×
                </Button>
              )}
            </Row>
          ))}
          {!data?.data?.length && <Text color="muted">Ej. Retainer, Proyecto, E-commerce.</Text>}
        </Row>
        {editable && (
          <Row gap="2" alignItems="flex-end">
            <Field label="Nuevo tipo">
              <TextField
                data-test="type-name"
                value={name}
                onChange={setName}
                placeholder="Retainer"
              />
            </Field>
            <Button
              data-test="type-create"
              variant="primary"
              isDisabled={!name.trim()}
              onPress={async () => {
                setError(null);
                try {
                  await post('/aurora/client-types', { name });
                  setName('');
                  refresh('client-types');
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Agregar
            </Button>
          </Row>
        )}
        <ErrorText error={error} />
      </Column>
    </Panel>
  );
}

const emptyForm = { id: '', name: '', workspaceId: '', clientTypeId: '', emails: '', notes: '' };

export function ClientsPage() {
  const { data: me } = useAuroraMe();
  const editable = canEdit(me?.role);
  const isAdmin = me?.role === 'admin';
  const { data: clients } = useAuroraQuery('clients', '/aurora/clients');
  const { data: workspaces } = useAuroraQuery('workspaces', '/aurora/workspaces');
  const { data: types } = useAuroraQuery('client-types', '/aurora/client-types');
  const { post, patch, del, refresh } = useAuroraActions();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<any>(null);
  const set = (key: keyof typeof emptyForm) => (value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const submit = async () => {
    setError(null);
    const contactEmails = parseEmails(form.emails);
    const bad = contactEmails.find(e => !isEmail(e));
    if (bad) {
      setError(`Email inválido: ${bad}`);
      return;
    }
    const body = {
      name: form.name,
      workspaceId: form.workspaceId || null,
      clientTypeId: form.clientTypeId || null,
      contactEmails,
      notes: form.notes || null,
    };
    try {
      if (form.id) {
        await patch(`/aurora/clients/${form.id}`, body);
      } else {
        await post('/aurora/clients', body);
      }
      setForm(emptyForm);
      refresh('clients', 'workspaces', 'client-types');
    } catch (e) {
      setError(e);
    }
  };

  const rows: any[] = clients?.data ?? [];

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Clientes"
          description="Organiza tus sitios por workspace (internal / external), cliente y tipo de cliente. Los contactos del cliente reciben sus reportes."
        />
        <Grid columns={{ base: '1fr', lg: '1fr 1fr' }} gap="6">
          <WorkspacesPanel editable={editable} isAdmin={isAdmin} />
          <ClientTypesPanel editable={editable} isAdmin={isAdmin} />
        </Grid>

        {editable && (
          <Panel title={form.id ? 'Editar cliente' : 'Nuevo cliente'}>
            <Column gap="3">
              <Grid columns={{ base: '1fr', md: '1fr 1fr 1fr' }} gap="3">
                <Field label="Nombre">
                  <TextField data-test="client-name" value={form.name} onChange={set('name')} />
                </Field>
                <Field label="Workspace">
                  <NativeSelect
                    testId="client-workspace"
                    value={form.workspaceId}
                    onChange={set('workspaceId')}
                    placeholder="—"
                    options={(workspaces?.data ?? []).map((w: any) => ({
                      value: w.id,
                      label: w.name,
                    }))}
                  />
                </Field>
                <Field label="Tipo de cliente">
                  <NativeSelect
                    testId="client-type"
                    value={form.clientTypeId}
                    onChange={set('clientTypeId')}
                    placeholder="—"
                    options={(types?.data ?? []).map((t: any) => ({ value: t.id, label: t.name }))}
                  />
                </Field>
              </Grid>
              <Field
                label="Contactos para reportes"
                hint="Separados por coma. Solo reciben reportes; no tienen cuenta."
              >
                <TextField
                  data-test="client-emails"
                  value={form.emails}
                  onChange={set('emails')}
                  placeholder="ana@cliente.com, ceo@cliente.com"
                />
              </Field>
              <Field label="Notas">
                <TextField value={form.notes} onChange={set('notes')} asTextArea />
              </Field>
              <ErrorText error={error} />
              <Row gap="2">
                <Button
                  data-test="client-save"
                  variant="primary"
                  isDisabled={!form.name.trim()}
                  onPress={submit}
                >
                  {form.id ? 'Guardar cambios' : 'Crear cliente'}
                </Button>
                {form.id && <Button onPress={() => setForm(emptyForm)}>Cancelar</Button>}
              </Row>
            </Column>
          </Panel>
        )}

        <Panel title="Lista de clientes">
          {rows.length ? (
            <SimpleTable
              testId="clients-table"
              columns={[
                { key: 'name', label: 'Cliente' },
                { key: 'workspace', label: 'Workspace' },
                { key: 'type', label: 'Tipo' },
                { key: 'sites', label: 'Sitios', align: 'right' },
                { key: 'contacts', label: 'Contactos' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={rows.map(c => ({
                key: c.id,
                cells: {
                  name: <Text weight="bold">{c.name}</Text>,
                  workspace: c.workspace ? (
                    <Pill color={c.workspace.color}>{c.workspace.name}</Pill>
                  ) : (
                    '—'
                  ),
                  type: c.clientType?.name ?? '—',
                  sites: c.websiteCount,
                  contacts: <Text size="sm">{c.contactEmails.join(', ') || '—'}</Text>,
                  actions: (
                    <Row gap="1" justifyContent="flex-end">
                      {editable && (
                        <Button
                          size="sm"
                          onPress={() =>
                            setForm({
                              id: c.id,
                              name: c.name,
                              workspaceId: c.workspaceId ?? '',
                              clientTypeId: c.clientTypeId ?? '',
                              emails: c.contactEmails.join(', '),
                              notes: c.notes ?? '',
                            })
                          }
                        >
                          Editar
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="quiet"
                          onPress={async () => {
                            await del(`/aurora/clients/${c.id}`);
                            refresh('clients', 'websites');
                          }}
                        >
                          Eliminar
                        </Button>
                      )}
                    </Row>
                  ),
                },
              }))}
            />
          ) : (
            <EmptyState
              title="Sin clientes todavía"
              description="Crea tu primer cliente arriba y asígnale sitios en Clasificación de sitios."
            />
          )}
        </Panel>
      </Column>
    </PageBody>
  );
}
