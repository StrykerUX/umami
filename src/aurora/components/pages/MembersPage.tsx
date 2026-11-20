'use client';
import { Button, Column, Grid, Row, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { formatDate, ROLE_LABELS } from '../format';
import { useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText, Field, NativeSelect } from '../ui';

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  accepted: 'Aceptada',
  expired: 'Vencida',
  revoked: 'Revocada',
};

export function MembersPage() {
  const { data: me } = useAuroraMe();
  const { data: members } = useAuroraQuery('members', '/aurora/members', {}, me?.role === 'admin');
  const { data: invites } = useAuroraQuery('invites', '/aurora/invites', {}, me?.role === 'admin');
  const { post, patch, del, refresh } = useAuroraActions();
  const [kind, setKind] = useState('email');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [maxUses, setMaxUses] = useState('10');
  const [link, setLink] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<any>(null);

  if (me && me.role !== 'admin') {
    return (
      <PageBody>
        <EmptyState
          title="Solo administradores"
          description="Pide a un admin que invite a nuevas personas."
        />
      </PageBody>
    );
  }

  const invite = async () => {
    setError(null);
    setNotice('');
    setLink('');
    try {
      const body =
        kind === 'email' ? { kind, email, role } : { kind, role, maxUses: Number(maxUses) || 10 };
      const result = await post('/aurora/invites', body);
      setLink(result.url);
      setNotice(
        kind === 'email'
          ? result.mailStatus === 'sent'
            ? `Invitación enviada a ${email}.`
            : `Invitación creada (${result.mailStatus ?? 'sin email'}). Comparte el link manualmente si no llega.`
          : 'Link de invitación creado. Cópialo ahora: no se vuelve a mostrar.',
      );
      setEmail('');
      refresh('invites');
    } catch (e) {
      setError(e);
    }
  };

  const action = async (fn: () => Promise<any>) => {
    setError(null);
    try {
      await fn();
      refresh('members', 'invites');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Miembros e invitaciones"
          description="Todos los miembros ven toda la información de la organización según su rol."
        />
        <Panel title="Invitar">
          <Column gap="3">
            <Grid columns={{ base: '1fr', md: 'auto 1fr auto auto' }} gap="3" alignItems="end">
              <Field label="Tipo">
                <NativeSelect
                  testId="invite-kind"
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'email', label: 'Por email' },
                    { value: 'link', label: 'Link reutilizable' },
                  ]}
                />
              </Field>
              {kind === 'email' ? (
                <Field label="Email">
                  <TextField
                    data-test="invite-email"
                    value={email}
                    onChange={setEmail}
                    placeholder="persona@empresa.com"
                  />
                </Field>
              ) : (
                <Field label="Usos máximos" hint="Vence en 7 días.">
                  <TextField value={maxUses} onChange={setMaxUses} />
                </Field>
              )}
              <Field label="Rol">
                <NativeSelect
                  testId="invite-role"
                  value={role}
                  onChange={setRole}
                  options={roleOptions}
                />
              </Field>
              <Button
                data-test="invite-submit"
                variant="primary"
                isDisabled={kind === 'email' && !email.includes('@')}
                onPress={invite}
              >
                Invitar
              </Button>
            </Grid>
            {notice && <Text data-test="invite-notice">{notice}</Text>}
            {link && (
              <Row gap="2" alignItems="center">
                <TextField data-test="invite-link" value={link} isReadOnly allowCopy />
              </Row>
            )}
            <ErrorText error={error} />
          </Column>
        </Panel>

        <Panel title="Miembros">
          {members?.data?.length ? (
            <SimpleTable
              testId="members-table"
              columns={[
                { key: 'user', label: 'Usuario' },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Rol' },
                { key: 'joined', label: 'Desde' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={members.data.map((m: any) => ({
                key: m.userId,
                cells: {
                  user: (
                    <Column>
                      <Text weight="bold">{m.displayName || m.username}</Text>
                      <Text size="sm" color="muted">
                        @{m.username}
                        {m.isOwner ? ' · dueño' : ''}
                      </Text>
                    </Column>
                  ),
                  email: m.email ?? '—',
                  role: m.isOwner ? (
                    ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]
                  ) : (
                    <NativeSelect
                      value={m.role}
                      onChange={v =>
                        action(() => patch(`/aurora/members/${m.userId}`, { role: v }))
                      }
                      options={roleOptions}
                    />
                  ),
                  joined: formatDate(m.joinedAt),
                  actions: m.isOwner ? null : (
                    <Button
                      size="sm"
                      variant="quiet"
                      onPress={() => action(() => del(`/aurora/members/${m.userId}`))}
                    >
                      Quitar
                    </Button>
                  ),
                },
              }))}
            />
          ) : (
            <EmptyState title="Cargando…" />
          )}
        </Panel>

        <Panel title="Invitaciones">
          {invites?.data?.length ? (
            <SimpleTable
              testId="invites-table"
              columns={[
                { key: 'who', label: 'Para' },
                { key: 'role', label: 'Rol' },
                { key: 'status', label: 'Estado' },
                { key: 'expires', label: 'Vence' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={invites.data.map((i: any) => ({
                key: i.id,
                cells: {
                  who: i.kind === 'email' ? i.email : `Link (${i.uses}/${i.maxUses} usos)`,
                  role: ROLE_LABELS[i.role as keyof typeof ROLE_LABELS] ?? i.role,
                  status: STATUS_LABELS[i.status] ?? i.status,
                  expires: formatDate(i.expiresAt),
                  actions: (
                    <Row gap="1" justifyContent="flex-end">
                      {i.kind === 'email' && ['pending', 'expired'].includes(i.status) && (
                        <Button
                          size="sm"
                          onPress={() => action(() => post(`/aurora/invites/${i.id}/resend`, {}))}
                        >
                          Reenviar
                        </Button>
                      )}
                      {i.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="quiet"
                          onPress={() => action(() => del(`/aurora/invites/${i.id}`))}
                        >
                          Revocar
                        </Button>
                      )}
                    </Row>
                  ),
                },
              }))}
            />
          ) : (
            <EmptyState title="Sin invitaciones" />
          )}
        </Panel>
      </Column>
    </PageBody>
  );
}
