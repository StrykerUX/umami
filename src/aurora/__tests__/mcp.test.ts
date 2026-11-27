import { allTools, McpToolError } from '@umami/mcp';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const calls: { method: string; url: URL; auth: string | null; body: any; params: any }[] = [];
const responses = new Map<string, () => Response>();

function handlerFor(key: string) {
  return async (request: Request, { params }: { params: Promise<any> }) => {
    const text = await request.text();
    calls.push({
      method: request.method,
      url: new URL(request.url),
      auth: request.headers.get('authorization'),
      body: text ? JSON.parse(text) : null,
      params: await params,
    });
    const make = responses.get(`${request.method} ${key}`);
    return make ? make() : Response.json({ error: { message: 'no stub' } }, { status: 500 });
  };
}

function mockRoute(key: string) {
  return {
    GET: handlerFor(key),
    POST: handlerFor(key),
    PUT: handlerFor(key),
    PATCH: handlerFor(key),
  };
}

vi.mock('@/app/api/aurora/workspaces/route', () => mockRoute('workspaces'));
vi.mock('@/app/api/aurora/client-types/route', () => mockRoute('client-types'));
vi.mock('@/app/api/aurora/clients/route', () => mockRoute('clients'));
vi.mock('@/app/api/aurora/clients/[id]/route', () => mockRoute('client'));
vi.mock('@/app/api/aurora/websites/route', () => mockRoute('websites'));
vi.mock('@/app/api/aurora/websites/[websiteId]/meta/route', () => mockRoute('meta'));
vi.mock('@/app/api/aurora/overview/route', () => mockRoute('overview'));
vi.mock('@/app/api/aurora/reports/route', () => mockRoute('reports'));
vi.mock('@/app/api/aurora/reports/[id]/runs/route', () => mockRoute('runs'));
vi.mock('@/app/api/aurora/reports/[id]/run/route', () => mockRoute('run'));
vi.mock('@/app/api/aurora/reports/runs/[runId]/route', () => mockRoute('run-detail'));
vi.mock('@/app/api/aurora/uptime/route', () => mockRoute('uptime'));
vi.mock('@/app/api/aurora/health/details/route', () => mockRoute('health'));

const { auroraCall, matchAuroraRoute } = await import('../mcp/dispatch');
const { getAuroraMcpTools, auroraTools, auroraWriteTools } = await import('../mcp');
const read = await import('../mcp/tools/read');
const write = await import('../mcp/tools/write');

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ctx = {
  client: { headers: { authorization: 'Bearer api_test' } } as any,
  logger: { info() {}, error() {} },
};

function stub(key: string, data: any, status = 200) {
  responses.set(key, () => Response.json(data, { status }));
}

beforeEach(() => {
  calls.length = 0;
  responses.clear();
});

describe('dispatch', () => {
  test('matches routes with params and rejects unknown ones', () => {
    expect(matchAuroraRoute('GET', `/api/aurora/clients/${ID}`)?.params).toEqual({ id: ID });
    expect(matchAuroraRoute('PUT', `/api/aurora/websites/${ID}/meta`)?.params).toEqual({
      websiteId: ID,
    });
    expect(matchAuroraRoute('DELETE', `/api/aurora/clients/${ID}`)).toBeNull();
    expect(matchAuroraRoute('GET', '/api/aurora/members')).toBeNull();
    expect(matchAuroraRoute('POST', '/api/aurora/cron')).toBeNull();
  });

  test('forwards the caller credentials, query and JSON body', async () => {
    stub('GET overview', { data: [] });
    await auroraCall(ctx, 'GET', '/api/aurora/overview', {
      query: { days: 7, clientId: undefined, workspaceId: '' },
    });
    expect(calls[0].auth).toBe('Bearer api_test');
    expect(calls[0].url.searchParams.get('days')).toBe('7');
    expect(calls[0].url.searchParams.has('clientId')).toBe(false);
    expect(calls[0].url.searchParams.has('workspaceId')).toBe(false);

    stub('PUT meta', { websiteId: ID });
    await auroraCall(ctx, 'PUT', `/api/aurora/websites/${ID}/meta`, { body: { tags: ['a'] } });
    expect(calls[1].body).toEqual({ tags: ['a'] });
    expect(calls[1].params).toEqual({ websiteId: ID });
  });

  test.each([
    [400, 'invalid_input', 'Cliente inválido.'],
    [401, 'auth_expired', undefined],
    [403, 'access_denied', 'Insufficient Aurora role.'],
    [404, 'not_found', 'Cliente no encontrado.'],
    [500, 'api_error', undefined],
  ])('maps HTTP %i to %s', async (status, code, message) => {
    stub('GET client', { error: { message: message ?? 'boom secret stack' } }, status);
    const error = await auroraCall(ctx, 'GET', `/api/aurora/clients/${ID}`).catch(e => e);
    expect(error).toBeInstanceOf(McpToolError);
    expect(error.code).toBe(code);
    if (message) expect(error.message).toBe(message);
    if (status >= 500) expect(error.message).not.toContain('secret');
  });

  test('missing credentials and unknown routes fail safely', async () => {
    await expect(
      auroraCall({ client: { headers: {} } as any }, 'GET', '/api/aurora/overview'),
    ).rejects.toMatchObject({ code: 'auth_expired' });
    await expect(auroraCall(ctx, 'GET', '/api/aurora/members')).rejects.toMatchObject({
      code: 'api_error',
    });
  });
});

describe('tool registry', () => {
  test('write tools are only exposed with AURORA_MCP_WRITE=1', () => {
    const off = getAuroraMcpTools({} as any).map(t => t.name);
    const on = getAuroraMcpTools({ AURORA_MCP_WRITE: '1' } as any).map(t => t.name);
    expect(off).not.toContain('aurora_run_report');
    expect(on).toEqual(expect.arrayContaining(['aurora_run_report', 'aurora_upsert_client']));
    expect(on.length).toBe(auroraTools.length + auroraWriteTools.length);
    expect(getAuroraMcpTools({ AURORA_MCP_WRITE: 'true' } as any).length).toBe(off.length);
  });

  test('getMcpTools keeps every Umami tool and appends Aurora tools', async () => {
    const { getMcpTools } = await import('../mcp');
    const names = (getMcpTools({} as any) ?? []).map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(allTools.map(t => t.name)));
    expect(names).toContain('aurora_overview');
    expect(names.length).toBe(allTools.length + auroraTools.length);
  });

  test('reads the bearer header built by UmamiClient', async () => {
    const { UmamiClient } = await import('@umami/api-client');
    const { getAuthorization } = await import('../mcp/dispatch');
    const client = new UmamiClient({ baseUrl: 'http://x/api', token: 'api_abc' });
    expect(getAuthorization({ client: client as any })).toBe('Bearer api_abc');
  });

  test('names are unique, prefixed and do not collide with Umami tools', () => {
    const names = getAuroraMcpTools({ AURORA_MCP_WRITE: '1' } as any).map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every(n => n.startsWith('aurora_'))).toBe(true);
    const core = new Set(allTools.map(t => t.name));
    expect(names.some(n => core.has(n))).toBe(false);
  });

  test('write tools are not marked read-only', () => {
    for (const tool of auroraWriteTools) {
      expect(tool.annotations?.readOnlyHint).toBe(false);
    }
    for (const tool of auroraTools) {
      expect(tool.annotations?.readOnlyHint).not.toBe(false);
    }
  });
});

describe('read tools', () => {
  const site = (
    id: string,
    visitors: number,
    visits: number,
    bounce: number,
    prevVisitors = 0,
  ) => ({
    id,
    name: `S${id.slice(0, 1)}`,
    domain: 'x.test',
    workspaceId: null,
    clientId: null,
    current: { pageviews: visitors * 2, visitors, visits, bounceRate: bounce, avgDuration: 60 },
    previous: {
      pageviews: 0,
      visitors: prevVisitors,
      visits: prevVisitors,
      bounceRate: 0,
      avgDuration: 0,
    },
    delta: {},
    uptime: null,
  });

  test('aurora_overview aggregates with weighted bounce and sorts sites', async () => {
    stub('GET overview', {
      days: 30,
      startAt: new Date().toISOString(),
      endAt: new Date().toISOString(),
      data: [site(ID, 10, 10, 50, 5), site(ID2, 30, 30, 10, 5)],
    });
    const out: any = await read.overview.handler({ days: 30, limit: 1 }, ctx as any);
    expect(out.totals.current).toMatchObject({ visitors: 40, visits: 40, bounceRate: 20 });
    expect(out.totals.deltaPct.visitors).toBe(300);
    expect(out.sites.map((s: any) => s.websiteId)).toEqual([ID2]);
    expect(out.truncated).toBe(true);
  });

  test('aurora_list_clients hides contact emails', async () => {
    stub('GET clients', {
      data: [{ id: ID, name: 'Acme', active: true, contactEmails: ['a@b.c'], websiteCount: 2 }],
    });
    const out: any = await read.listClients.handler({}, ctx as any);
    expect(out.clients[0]).toMatchObject({ contactCount: 1, websiteCount: 2 });
    expect(JSON.stringify(out)).not.toContain('a@b.c');
  });

  test('aurora_get_report_run resolves the latest run from a reportId', async () => {
    stub('GET runs', { data: [{ id: ID2 }] });
    stub('GET run-detail', {
      id: ID2,
      scheduleId: ID,
      status: 'sent',
      sentTo: ['x@y.z'],
      shareUrl: 'https://a/r/t',
      snapshot: { totals: {} },
    });
    const out: any = await read.getReportRun.handler({ reportId: ID }, ctx as any);
    expect(out).toMatchObject({ id: ID2, recipientCount: 1, shareUrl: 'https://a/r/t' });
    expect(JSON.stringify(out)).not.toContain('x@y.z');

    stub('GET runs', { data: [] });
    await expect(read.getReportRun.handler({ reportId: ID }, ctx as any)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(read.getReportRun.handler({}, ctx as any)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  test('uptime status and incidents', async () => {
    stub('GET uptime', {
      data: [
        {
          id: ID,
          name: 'A',
          monitor: {
            status: 'down',
            enabled: true,
            uptimePct: 99.5,
            checks: 10,
            alertEmails: ['ops@x.y'],
            incidents: [
              { id: 'i1', startedAt: '2026-11-01T00:00:00Z', resolvedAt: '2026-11-01T00:30:00Z' },
              { id: 'i2', startedAt: '2026-11-02T00:00:00Z', resolvedAt: null },
            ],
          },
        },
        { id: ID2, name: 'B', monitor: null },
      ],
    });
    const status: any = await read.uptimeStatus.handler({}, ctx as any);
    expect(status).toMatchObject({ down: 1, monitored: 1 });
    expect(status.sites[0].openIncident).toBe(true);
    expect(JSON.stringify(status)).not.toContain('ops@x.y');

    const inc: any = await read.listIncidents.handler({}, ctx as any);
    expect(inc.incidents.map((i: any) => i.id)).toEqual(['i2', 'i1']);
    expect(inc.incidents[1].durationMinutes).toBe(30);
    const open: any = await read.listIncidents.handler({ openOnly: true }, ctx as any);
    expect(open.incidents.map((i: any) => i.id)).toEqual(['i2']);
  });
});

describe('write tools', () => {
  test('aurora_run_report defaults to preview (send=false)', async () => {
    stub('POST run', { runId: ID2, status: 'preview', sentTo: [], url: 'https://a/r/t' });
    const out: any = await write.runReport.handler({ reportId: ID }, ctx as any);
    expect(calls[0].body).toEqual({ send: false });
    expect(out).toMatchObject({ sent: false, shareUrl: 'https://a/r/t' });
  });

  test('aurora_upsert_client creates without id and patches with id', async () => {
    stub('POST clients', { id: ID, name: 'New', contactEmails: [] });
    stub('PATCH client', { id: ID, name: 'Renamed', contactEmails: [] });
    const created: any = await write.upsertClient.handler({ name: 'New' }, ctx as any);
    const updated: any = await write.upsertClient.handler(
      { clientId: ID, name: 'Renamed' },
      ctx as any,
    );
    expect(calls.map(c => c.method)).toEqual(['POST', 'PATCH']);
    expect(calls[1].params).toEqual({ id: ID });
    expect(calls[1].body).toEqual({ name: 'Renamed' });
    expect(created.created).toBe(true);
    expect(updated.created).toBe(false);
  });

  test('a 403 from the API surfaces as access_denied', async () => {
    stub('PUT meta', { error: { message: 'Insufficient Aurora role.' } }, 403);
    await expect(
      write.classifyWebsite.handler({ websiteId: ID, tags: ['x'] }, ctx as any),
    ).rejects.toMatchObject({ code: 'access_denied' });
  });
});
