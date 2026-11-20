'use client';
import { Button, Column, Row, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { canEdit, useAuroraActions, useAuroraMe, useAuroraQuery } from '../hooks';
import { SimpleTable } from '../table';
import { EmptyState, ErrorText, NativeSelect, StatusDot } from '../ui';

function TagsEditor({
  value,
  onSave,
  disabled,
}: {
  value: string[];
  onSave: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value.join(', '));
  const dirty = text !== value.join(', ');

  return (
    <Row gap="2" alignItems="center">
      <TextField value={text} onChange={setText} isDisabled={disabled} placeholder="tag1, tag2" />
      {dirty && (
        <Button
          size="sm"
          onPress={() =>
            onSave(
              text
                .split(',')
                .map(t => t.trim())
                .filter(Boolean),
            )
          }
        >
          Guardar
        </Button>
      )}
    </Row>
  );
}

export function SitesPage() {
  const { data: me } = useAuroraMe();
  const editable = canEdit(me?.role);
  const { data, isLoading, error } = useAuroraQuery('websites', '/aurora/websites');
  const { data: workspaces } = useAuroraQuery('workspaces', '/aurora/workspaces');
  const { data: clients } = useAuroraQuery('clients', '/aurora/clients');
  const { put, refresh } = useAuroraActions();
  const [saveError, setSaveError] = useState<any>(null);

  const save = async (websiteId: string, meta: object) => {
    setSaveError(null);
    try {
      await put(`/aurora/websites/${websiteId}/meta`, meta);
      refresh('websites', 'overview', 'clients');
    } catch (e) {
      setSaveError(e);
    }
  };

  const rows: any[] = data?.data ?? [];

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader
          title="Clasificación de sitios"
          description="Asigna cada sitio a un workspace (internal / external), a un cliente y a tags. Los sitios nuevos se crean en Sitios web."
        />
        <ErrorText error={saveError} />
        <Panel>
          <LoadingPanel
            data={data}
            isLoading={isLoading}
            error={error}
            isEmpty={!rows.length}
            renderEmpty={() => (
              <EmptyState
                title="Aún no hay sitios"
                description="Crea un sitio desde Sitios web y aparecerá aquí."
              />
            )}
          >
            <SimpleTable
              testId="sites-table"
              columns={[
                { key: 'name', label: 'Sitio' },
                { key: 'workspace', label: 'Workspace' },
                { key: 'client', label: 'Cliente' },
                { key: 'tags', label: 'Tags' },
                { key: 'uptime', label: 'Uptime' },
              ]}
              rows={rows.map(w => ({
                key: w.id,
                cells: {
                  name: (
                    <Column>
                      <Text weight="bold">{w.name}</Text>
                      <Text size="sm" color="muted">
                        {w.domain}
                      </Text>
                    </Column>
                  ),
                  workspace: (
                    <NativeSelect
                      testId={`ws-${w.id}`}
                      disabled={!editable}
                      value={w.workspaceId ?? ''}
                      placeholder="—"
                      onChange={v => save(w.id, { workspaceId: v || null })}
                      options={(workspaces?.data ?? []).map((x: any) => ({
                        value: x.id,
                        label: `${x.name} (${x.kind === 'internal' ? 'internal' : 'external'})`,
                      }))}
                    />
                  ),
                  client: (
                    <NativeSelect
                      testId={`client-${w.id}`}
                      disabled={!editable}
                      value={w.clientId ?? ''}
                      placeholder="—"
                      onChange={v => save(w.id, { clientId: v || null })}
                      options={(clients?.data ?? []).map((c: any) => ({
                        value: c.id,
                        label: c.name,
                      }))}
                    />
                  ),
                  tags: (
                    <TagsEditor
                      key={w.tags.join(',')}
                      value={w.tags}
                      disabled={!editable}
                      onSave={tags => save(w.id, { tags })}
                    />
                  ),
                  uptime: w.monitor ? (
                    <StatusDot status={w.monitor.status} />
                  ) : (
                    <Text color="muted">—</Text>
                  ),
                },
              }))}
            />
          </LoadingPanel>
        </Panel>
      </Column>
    </PageBody>
  );
}
