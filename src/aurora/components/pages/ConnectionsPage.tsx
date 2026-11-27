'use client';
import { Button, Column, Row, Switch, Text } from '@umami/react-zen';
import { useState } from 'react';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { formatDate } from '../format';
import { useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText } from '../ui';

export function ConnectionsPage() {
  const { data: me } = useAuroraMe();
  const isAdmin = me?.role === 'admin';
  const [all, setAll] = useState(false);
  const { data, isLoading, error } = useAuroraQuery(
    'connections',
    '/aurora/oauth/grants',
    all ? { all: 1 } : {},
  );
  const { del, refresh } = useAuroraActions();
  const [actionError, setActionError] = useState<any>(null);
  const mcpUrl = typeof window !== 'undefined' ? `${window.location.origin}/mcp` : '/mcp';

  const revoke = async (id: string) => {
    setActionError(null);
    try {
      await del(`/aurora/oauth/grants/${id}`);
      refresh('connections');
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <PageBody>
      <PageHeader title="Conexiones" />
      <Column gap="4">
        <Panel>
          <Column gap="2">
            <Text weight="bold">Conectar Claude (claude.ai)</Text>
            <Text>
              En claude.ai: Configuración → Conectores → Agregar conector personalizado, con la URL:
            </Text>
            <Text data-test="mcp-url" style={{ fontFamily: 'monospace' }}>
              {mcpUrl}
            </Text>
            <Text color="muted" size="sm">
              Claude te enviará aquí para autorizar. El acceso usa tus permisos actuales y puedes
              revocarlo en esta página.
            </Text>
          </Column>
        </Panel>
        <Panel>
          <Column gap="3">
            {isAdmin && (
              <Row>
                <Switch isSelected={all} onChange={setAll}>
                  Ver conexiones de todos los miembros
                </Switch>
              </Row>
            )}
            <ErrorText error={actionError} />
            <LoadingPanel data={data} isLoading={isLoading} error={error}>
              {data?.data?.length ? (
                <SimpleTable
                  testId="connections"
                  columns={[
                    { key: 'app', label: 'Aplicación' },
                    ...(all ? [{ key: 'user', label: 'Usuario' }] : []),
                    { key: 'created', label: 'Conectada' },
                    { key: 'used', label: 'Último uso' },
                    { key: 'actions', label: '', align: 'right' as const, width: 120 },
                  ]}
                  rows={data.data.map((g: any) => ({
                    key: g.id,
                    cells: {
                      app: g.clientName,
                      user: g.username ?? '—',
                      created: formatDate(g.createdAt, true),
                      used: g.lastUsedAt ? formatDate(g.lastUsedAt, true) : '—',
                      actions: (
                        <Button data-test="revoke-connection" onPress={() => revoke(g.id)}>
                          Revocar
                        </Button>
                      ),
                    },
                  }))}
                />
              ) : (
                <EmptyState
                  title="Sin aplicaciones conectadas"
                  description="Cuando conectes Claude u otra app por OAuth aparecerá aquí."
                />
              )}
            </LoadingPanel>
          </Column>
        </Panel>
      </Column>
    </PageBody>
  );
}
