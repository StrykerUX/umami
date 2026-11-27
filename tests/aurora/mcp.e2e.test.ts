/**
 * Aurora MCP end-to-end: JSON-RPC over HTTP against the embedded /mcp endpoint with real API keys.
 * The server must run with MCP_ENABLED=1 and AURORA_MCP_WRITE=1 (scripts/aurora-e2e.ts sets both).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import prisma from '@/lib/prisma';

const BASE = (process.env.AURORA_E2E_URL || 'http://localhost:3100').replace(/\/$/, '');
const RUN = `mcp${Date.now().toString(36)}`;

async function api(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

async function rpc(key: string, method: string, params: Record<string, unknown> = {}) {
  const legacy = method === 'initialize';
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key}`,
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      'mcp-protocol-version': legacy ? '2025-11-25' : '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: legacy
        ? params
        : {
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'aurora-e2e', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
    }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => JSON.parse(line.slice(5)))
      .find(message => message.id === 1);
  }
  expect(body?.error, JSON.stringify(body?.error)).toBeUndefined();
  return body.result;
}

const call = (key: string, name: string, args: Record<string, unknown> = {}) =>
  rpc(key, 'tools/call', { name, arguments: args });

async function linkFromEmail(to: string, pathPrefix: string) {
  const rows = (await prisma.client.$queryRawUnsafe(
    `select html from aurora_email_log where $1 = any("to") order by created_at desc limit 1`,
    to,
  )) as any[];
  expect(rows.length, `no email for ${to}`).toBe(1);
  const match = rows[0].html.match(new RegExp(`https?://[^"\\s]*${pathPrefix}([^"\\s<]+)`));
  expect(match, `no ${pathPrefix} link in email`).toBeTruthy();
  return decodeURIComponent(match[1]);
}

let admin: string;
let adminKey: string;
let viewerKey: string;
let websiteId: string;
let clientId: string;
let workspaceId: string;
let reportId: string;

beforeAll(async () => {
  const login = await api('POST', '/auth/login', {
    username: 'admin',
    password: process.env.AURORA_E2E_ADMIN_PASSWORD || 'umami',
  });
  expect(login.status).toBe(200);
  admin = login.data.token;

  const key = await api('POST', '/me/api-keys', { name: `mcp-admin-${RUN}` }, admin);
  expect(key.status, JSON.stringify(key.data)).toBe(200);
  adminKey = key.data.key;

  const site = await api(
    'POST',
    '/websites',
    { name: `MCP ${RUN}`, domain: `${RUN}.aurora.test` },
    admin,
  );
  expect(site.status, JSON.stringify(site.data)).toBe(200);
  websiteId = site.data.id;

  const ws = await api(
    'POST',
    '/aurora/workspaces',
    { name: `WS ${RUN}`, kind: 'external' },
    admin,
  );
  workspaceId = ws.data.id;
  const client = await api(
    'POST',
    '/aurora/clients',
    { name: `Cliente ${RUN}`, workspaceId, contactEmails: [`c-${RUN}@example.com`] },
    admin,
  );
  clientId = client.data.id;
  const report = await api(
    'POST',
    '/aurora/reports',
    { name: `Rep ${RUN}`, scope: 'client', scopeId: clientId, frequency: 'monthly' },
    admin,
  );
  expect(report.status, JSON.stringify(report.data)).toBe(200);
  reportId = report.data.id;
  await api('PUT', `/aurora/uptime/${websiteId}`, { url: `https://${RUN}.aurora.test` }, admin);

  // Viewer via email invite, then their own API key.
  const email = `viewer-${RUN}@example.com`;
  const inv = await api('POST', '/aurora/invites', { kind: 'email', email, role: 'viewer' }, admin);
  expect(inv.status, JSON.stringify(inv.data)).toBe(200);
  const token = await linkFromEmail(email, '/invite/');
  const accept = await api('POST', '/aurora/invites/accept', {
    token,
    username: `viewer_${RUN}`,
    password: `Viewer-${RUN}-pass`,
    displayName: 'Viewer MCP',
  });
  expect(accept.status, JSON.stringify(accept.data)).toBe(200);
  const vkey = await api('POST', '/me/api-keys', { name: `mcp-viewer-${RUN}` }, accept.data.token);
  expect(vkey.status, JSON.stringify(vkey.data)).toBe(200);
  viewerKey = vkey.data.key;
});

afterAll(async () => {
  await prisma.client.$disconnect();
});

describe('MCP with Aurora tools', () => {
  test('rejects calls without an API key', async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  test('initializes and lists Umami + Aurora tools', async () => {
    const init = await rpc(adminKey, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'aurora-e2e', version: '1.0.0' },
    });
    expect(init.serverInfo.name).toBeTruthy();

    const { tools } = await rpc(adminKey, 'tools/list');
    const names = tools.map((t: any) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'list_websites',
        'get_website_stats',
        'aurora_overview',
        'aurora_list_clients',
        'aurora_client_summary',
        'aurora_uptime_status',
        'aurora_run_report',
      ]),
    );
    const runReport = tools.find((t: any) => t.name === 'aurora_run_report');
    expect(runReport.annotations.readOnlyHint).toBe(false);
  });

  test('read tools return organization data through the API key', async () => {
    const ws = await call(viewerKey, 'aurora_list_workspaces');
    expect(ws.isError).not.toBe(true);
    expect(ws.structuredContent.workspaces.map((w: any) => w.id)).toContain(workspaceId);

    const clients = await call(viewerKey, 'aurora_list_clients', { workspaceId });
    expect(clients.structuredContent.clients).toEqual([
      expect.objectContaining({ id: clientId, contactCount: 1 }),
    ]);
    expect(JSON.stringify(clients.structuredContent)).not.toContain('@example.com');

    const ov = await call(viewerKey, 'aurora_overview', { days: 7 });
    expect(ov.isError, JSON.stringify(ov)).not.toBe(true);
    expect(ov.structuredContent.siteCount).toBeGreaterThanOrEqual(1);
    expect(ov.structuredContent.totals.current).toHaveProperty('visitors');

    const reports = await call(viewerKey, 'aurora_list_reports', { scopeId: clientId });
    expect(reports.structuredContent.reports.map((r: any) => r.id)).toEqual([reportId]);

    const uptime = await call(viewerKey, 'aurora_uptime_status', { websiteId });
    expect(uptime.structuredContent.sites).toEqual([
      expect.objectContaining({ websiteId, monitored: true }),
    ]);
  });

  test('editor-level writes: admin can classify and preview a report, viewer is denied', async () => {
    const denied = await call(viewerKey, 'aurora_classify_website', { websiteId, clientId });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent.error.code).toBe('access_denied');

    const classified = await call(adminKey, 'aurora_classify_website', {
      websiteId,
      clientId,
      tags: ['mcp'],
    });
    expect(classified.isError, JSON.stringify(classified)).not.toBe(true);
    expect(classified.structuredContent).toMatchObject({ clientId, workspaceId, tags: ['mcp'] });

    const summary = await call(viewerKey, 'aurora_client_summary', { clientId, days: 7 });
    expect(summary.isError, JSON.stringify(summary)).not.toBe(true);
    expect(summary.structuredContent.overview.sites.map((s: any) => s.websiteId)).toEqual([
      websiteId,
    ]);
    expect(summary.structuredContent.reports.map((r: any) => r.id)).toEqual([reportId]);

    const before = (await prisma.client.$queryRawUnsafe(
      `select count(*)::int as n from aurora_email_log where kind = 'report'`,
    )) as any[];
    const run = await call(adminKey, 'aurora_run_report', { reportId });
    expect(run.isError, JSON.stringify(run)).not.toBe(true);
    expect(run.structuredContent).toMatchObject({ sent: false, recipientCount: 0 });
    expect(run.structuredContent.shareUrl).toContain('/r/');
    const after = (await prisma.client.$queryRawUnsafe(
      `select count(*)::int as n from aurora_email_log where kind = 'report'`,
    )) as any[];
    expect(after[0].n).toBe(before[0].n);

    const latest = await call(viewerKey, 'aurora_get_report_run', { reportId });
    expect(latest.structuredContent.id).toBe(run.structuredContent.runId);
    expect(latest.structuredContent.snapshot).toBeTruthy();

    const viewerRun = await call(viewerKey, 'aurora_run_report', { reportId });
    expect(viewerRun.structuredContent.error.code).toBe('access_denied');
  });

  test('upsert client and admin-only health', async () => {
    const created = await call(adminKey, 'aurora_upsert_client', { name: `Nuevo ${RUN}` });
    expect(created.structuredContent.created).toBe(true);
    const updated = await call(adminKey, 'aurora_upsert_client', {
      clientId: created.structuredContent.client.id,
      active: false,
    });
    expect(updated.structuredContent.client.active).toBe(false);

    const viewerHealth = await call(viewerKey, 'aurora_health');
    expect(viewerHealth.structuredContent.error.code).toBe('access_denied');
  });
});
