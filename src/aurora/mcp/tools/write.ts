import { z } from 'zod';
import { auroraCall } from '../dispatch';
import { defineAuroraTool, iso } from './define';

const WRITE = ' Requires the Editor role or higher.';

export const runReport = defineAuroraTool({
  name: 'aurora_run_report',
  title: 'Run Aurora report',
  description:
    'Runs a scheduled report now for its last completed period. By default send=false: builds a preview run and returns its shareable link without emailing anyone. ' +
    'Only set send=true when the user explicitly asks to email the recipients.' +
    WRITE,
  inputSchema: z.object({
    reportId: z.uuid(),
    send: z.boolean().optional().describe('Email the recipients (default false = preview only).'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async handler(input, context) {
    const result = await auroraCall(context, 'POST', `/api/aurora/reports/${input.reportId}/run`, {
      body: { send: input.send ?? false },
    });

    return {
      runId: result.runId,
      status: result.status,
      error: result.error ?? null,
      sent: input.send ?? false,
      recipientCount: result.sentTo?.length ?? 0,
      shareUrl: result.url,
    };
  },
});

export const classifyWebsite = defineAuroraTool({
  name: 'aurora_classify_website',
  title: 'Classify Aurora website',
  description:
    'Sets a website’s workspace, client and/or tags. A client implies its workspace when workspaceId is omitted; pass null to clear a field. ' +
    'Tags replace the existing list.' +
    WRITE,
  inputSchema: z.object({
    websiteId: z.uuid(),
    workspaceId: z.uuid().nullable().optional(),
    clientId: z.uuid().nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const { websiteId, ...body } = input;
    const meta = await auroraCall(context, 'PUT', `/api/aurora/websites/${websiteId}/meta`, {
      body,
    });

    return {
      websiteId: meta.websiteId,
      workspaceId: meta.workspaceId ?? null,
      clientId: meta.clientId ?? null,
      tags: meta.tags ?? [],
    };
  },
});

export const upsertClient = defineAuroraTool({
  name: 'aurora_upsert_client',
  title: 'Create or update Aurora client',
  description:
    'Creates a client (omit clientId; name required) or updates one (pass clientId and only the fields to change). ' +
    'Clients never log in; contactEmails receive the client’s reports.' +
    WRITE,
  inputSchema: z.object({
    clientId: z.uuid().optional(),
    name: z.string().trim().min(1).max(150).optional(),
    workspaceId: z.uuid().nullable().optional(),
    clientTypeId: z.uuid().nullable().optional(),
    contactEmails: z.array(z.email().max(320)).max(50).optional(),
    notes: z.string().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  async handler(input, context) {
    const { clientId, ...fields } = input;
    const client = clientId
      ? await auroraCall(context, 'PATCH', `/api/aurora/clients/${clientId}`, { body: fields })
      : await auroraCall(context, 'POST', '/api/aurora/clients', { body: fields });

    return {
      created: !clientId,
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        workspaceId: client.workspaceId ?? null,
        clientTypeId: client.clientTypeId ?? null,
        contactCount: client.contactEmails?.length ?? 0,
        updatedAt: iso(client.updatedAt),
      },
    };
  },
});

export const auroraWriteTools = [runReport, classifyWebsite, upsertClient];
