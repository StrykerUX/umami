/**
 * Aurora end-to-end: real HTTP against a running server and a real Postgres.
 * Env: AURORA_E2E_URL, DATABASE_URL, AURORA_CRON_SECRET (same as the server).
 * The server must run with AURORA_MAIL_DRIVER=outbox so emails land in aurora_email_log.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getReportPeriods } from '@/aurora/lib/periods';
import prisma from '@/lib/prisma';

const BASE = (process.env.AURORA_E2E_URL || 'http://localhost:3100').replace(/\/$/, '');
const CRON = process.env.AURORA_CRON_SECRET || '';
const RUN = Date.now().toString(36);
const db = {
  query: async (sql: string, params: any[] = []) => ({
    rows: (await prisma.client.$queryRawUnsafe(sql, ...params)) as any[],
  }),
  exec: (sql: string, params: any[] = []) => prisma.client.$executeRawUnsafe(sql, ...params),
};

type Res = { status: number; data: any };

async function api(
  method: string,
  path: string,
  body?: any,
  token?: string,
  headers: Record<string, string> = {},
): Promise<Res> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function login(username: string, password: string) {
  const r = await api('POST', '/auth/login', { username, password });
  return r.status === 200 ? (r.data.token as string) : null;
}

/** Latest outbox email to an address; returns the first link matching `pathPrefix`. */
async function linkFromEmail(to: string, pathPrefix: string) {
  const { rows } = await db.query(
    `select html from aurora_email_log where $1 = any("to") order by created_at desc limit 1`,
    [to],
  );
  expect(rows.length, `no email for ${to}`).toBe(1);
  const match = rows[0].html.match(new RegExp(`https?://[^"\\s]*${pathPrefix}([^"\\s<]+)`));
  expect(match, `no ${pathPrefix} link in email`).toBeTruthy();
  return decodeURIComponent(match[1]);
}

async function track(websiteId: string, when: Date, path: string, ua: string) {
  const r = await api(
    'POST',
    '/send',
    {
      type: 'event',
      payload: {
        website: websiteId,
        hostname: 'e2e.aurora.test',
        url: path,
        title: 'E2E',
        referrer: 'https://google.com/',
        language: 'es-MX',
        screen: '1920x1080',
        timestamp: Math.floor(when.getTime() / 1000),
      },
    },
    undefined,
    {
      'user-agent': ua,
      'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
  );
  expect(r.status, JSON.stringify(r.data)).toBe(200);
}

const UA = (n: number) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_${n}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.${n}.0 Safari/537.36`;

let admin: string;
let orgId: string;
let websiteId: string;
let workspaceId: string;
let clientId: string;
let viewer: { username: string; password: string; token: string; email: string; userId?: string };
const clientEmail = `cliente-${RUN}@example.com`;

beforeAll(async () => {
  const hb = await fetch(`${BASE}/api/heartbeat`);
  expect(hb.ok).toBe(true);
  const token = await login('admin', process.env.AURORA_E2E_ADMIN_PASSWORD || 'umami');
  expect(token, 'admin login').toBeTruthy();
  admin = token as string;
});

afterAll(async () => {
  await prisma.client.$disconnect();
});

describe('organization', () => {
  test('admin gets the single organization', async () => {
    const r = await api('GET', '/aurora/me', undefined, admin);
    expect(r.status).toBe(200);
    expect(r.data.role).toBe('admin');
    expect(r.data.orgId).toMatch(/^[0-9a-f-]{36}$/);
    orgId = r.data.orgId;
  });

  test('a website created without team lands in the organization', async () => {
    const r = await api(
      'POST',
      '/websites',
      { name: `E2E ${RUN}`, domain: `e2e-${RUN}.aurora.test` },
      admin,
    );
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    expect(r.data.teamId).toBe(orgId);
    expect(r.data.userId).toBeNull();
    websiteId = r.data.id;
  });

  test('unauthenticated access is rejected', async () => {
    expect((await api('GET', '/aurora/me')).status).toBe(401);
    expect((await api('GET', '/aurora/overview')).status).toBe(401);
  });
});

describe('workspaces & clients', () => {
  test('create workspace, client type and client; classify the site', async () => {
    const ws = await api(
      'POST',
      '/aurora/workspaces',
      { name: `External ${RUN}`, kind: 'external', color: '#22c7d6' },
      admin,
    );
    expect(ws.status, JSON.stringify(ws.data)).toBe(200);
    workspaceId = ws.data.id;

    const dup = await api(
      'POST',
      '/aurora/workspaces',
      { name: `External ${RUN}`, kind: 'external' },
      admin,
    );
    expect(dup.status).toBe(400);

    const type = await api('POST', '/aurora/client-types', { name: `Retainer ${RUN}` }, admin);
    expect(type.status).toBe(200);

    const client = await api(
      'POST',
      '/aurora/clients',
      {
        name: `Cliente ${RUN}`,
        workspaceId,
        clientTypeId: type.data.id,
        contactEmails: [clientEmail.toUpperCase()],
      },
      admin,
    );
    expect(client.status, JSON.stringify(client.data)).toBe(200);
    expect(client.data.contactEmails).toEqual([clientEmail]);
    clientId = client.data.id;

    const meta = await api(
      'PUT',
      `/aurora/websites/${websiteId}/meta`,
      { clientId, tags: ['e2e', 'e2e'] },
      admin,
    );
    expect(meta.status, JSON.stringify(meta.data)).toBe(200);
    expect(meta.data.workspaceId).toBe(workspaceId); // inherited from client
    expect(meta.data.tags).toEqual(['e2e']);

    const sites = await api('GET', '/aurora/websites', undefined, admin);
    const site = sites.data.data.find((w: any) => w.id === websiteId);
    expect(site).toMatchObject({ clientId, workspaceId, tags: ['e2e'] });

    const filtered = await api(
      'GET',
      `/aurora/overview?days=30&clientTypeId=${type.data.id}`,
      undefined,
      admin,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.data.data.map((w: any) => w.id)).toEqual([websiteId]);
  });
});

describe('invitations', () => {
  test('email invite -> sign up -> viewer sees org data but cannot edit', async () => {
    const email = `viewer-${RUN}@example.com`;
    const inv = await api(
      'POST',
      '/aurora/invites',
      { kind: 'email', email, role: 'viewer' },
      admin,
    );
    expect(inv.status, JSON.stringify(inv.data)).toBe(200);
    expect(inv.data.mailStatus).toBe('outbox');
    expect(inv.data.invite.tokenHash).toBeUndefined();

    const token = await linkFromEmail(email, '/invite/');
    const check = await api('GET', `/aurora/invites/accept?token=${encodeURIComponent(token)}`);
    expect(check.status).toBe(200);
    expect(check.data).toMatchObject({ email, role: 'viewer' });

    const password = `Viewer-${RUN}-pass`;
    const username = `viewer_${RUN}`;
    const accept = await api('POST', '/aurora/invites/accept', {
      token,
      username,
      password,
      displayName: 'Ana E2E',
    });
    expect(accept.status, JSON.stringify(accept.data)).toBe(200);
    expect(accept.data.token).toBeTruthy();
    viewer = { username, password, token: accept.data.token, email, userId: accept.data.user.id };

    const reuse = await api('POST', '/aurora/invites/accept', {
      token,
      username: `${username}2`,
      password,
    });
    expect(reuse.status).toBe(400);

    const me = await api('GET', '/aurora/me', undefined, viewer.token);
    expect(me.data).toMatchObject({ orgId, role: 'viewer', email });

    // Shared visibility: the viewer sees the org's website and its stats.
    const teamSites = await api('GET', `/teams/${orgId}/websites`, undefined, viewer.token);
    expect(teamSites.status).toBe(200);
    expect(teamSites.data.data.map((w: any) => w.id)).toContain(websiteId);
    const stats = await api(
      'GET',
      `/websites/${websiteId}/stats?startAt=0&endAt=${Date.now()}`,
      undefined,
      viewer.token,
    );
    expect(stats.status).toBe(200);

    // Read-only role.
    expect((await api('POST', '/aurora/clients', { name: 'nope' }, viewer.token)).status).toBe(403);
    expect(
      (await api('POST', '/websites', { name: 'nope', domain: 'nope.test' }, viewer.token)).status,
    ).toBe(401);
    expect((await api('GET', '/aurora/members', undefined, viewer.token)).status).toBe(403);
    expect((await api('GET', '/aurora/invites', undefined, viewer.token)).status).toBe(403);
  });

  test('duplicate email invite is rejected', async () => {
    const r = await api(
      'POST',
      '/aurora/invites',
      { kind: 'email', email: viewer.email, role: 'viewer' },
      admin,
    );
    expect(r.status).toBe(400);
  });

  test('link invite honours max uses and revocation', async () => {
    const inv = await api(
      'POST',
      '/aurora/invites',
      { kind: 'link', role: 'editor', maxUses: 1, ttlDays: 1 },
      admin,
    );
    expect(inv.status).toBe(200);
    const token = decodeURIComponent(inv.data.url.split('/invite/')[1]);

    const a = await api('POST', '/aurora/invites/accept', {
      token,
      username: `editor_${RUN}`,
      password: 'Editor-pass-123',
      email: `editor-${RUN}@example.com`,
    });
    expect(a.status, JSON.stringify(a.data)).toBe(200);
    const meEditor = await api('GET', '/aurora/me', undefined, a.data.token);
    expect(meEditor.data.role).toBe('editor');
    expect(
      (await api('POST', '/aurora/client-types', { name: `Editor type ${RUN}` }, a.data.token))
        .status,
    ).toBe(200);

    const b = await api('POST', '/aurora/invites/accept', {
      token,
      username: `editor2_${RUN}`,
      password: 'Editor-pass-123',
      email: `editor2-${RUN}@example.com`,
    });
    expect(b.status).toBe(400);

    const inv2 = await api('POST', '/aurora/invites', { kind: 'link', role: 'viewer' }, admin);
    expect(
      (await api('DELETE', `/aurora/invites/${inv2.data.invite.id}`, undefined, admin)).status,
    ).toBe(200);
    const t2 = decodeURIComponent(inv2.data.url.split('/invite/')[1]);
    expect(
      (await api('GET', `/aurora/invites/accept?token=${encodeURIComponent(t2)}`)).status,
    ).toBe(404);
  });

  test('admin can promote a member', async () => {
    const r = await api('PATCH', `/aurora/members/${viewer.userId}`, { role: 'editor' }, admin);
    expect(r.status).toBe(200);
    const me = await api('GET', '/aurora/me', undefined, viewer.token);
    expect(me.data.role).toBe('editor');
    await api('PATCH', `/aurora/members/${viewer.userId}`, { role: 'viewer' }, admin);
  });
});

describe('password reset', () => {
  test('forgot -> email -> reset -> old password stops working', async () => {
    const r = await api('POST', '/aurora/password/forgot', { identifier: viewer.email });
    expect(r.status).toBe(200);
    const unknown = await api('POST', '/aurora/password/forgot', {
      identifier: `nobody-${RUN}@example.com`,
    });
    expect(unknown.status).toBe(200); // no account enumeration

    const token = await linkFromEmail(viewer.email, '/reset/');
    const newPassword = `New-${RUN}-pass`;
    expect(
      (await api('POST', '/aurora/password/reset', { token, password: newPassword })).status,
    ).toBe(200);
    expect(
      (await api('POST', '/aurora/password/reset', { token, password: 'Another-123' })).status,
    ).toBe(400);

    expect(await login(viewer.username, viewer.password)).toBeNull();
    const fresh = await login(viewer.username, newPassword);
    expect(fresh).toBeTruthy();
    // Sessions issued before the change are invalidated.
    expect((await api('GET', '/aurora/me', undefined, viewer.token)).status).toBe(401);
    viewer.token = fresh as string;
    viewer.password = newPassword;
  });
});

describe('reports', () => {
  let scheduleId: string;

  test('report compares the last completed week against the previous one and emails the client', async () => {
    const tz = 'America/Mexico_City';
    const p = getReportPeriods('weekly', new Date(), tz);
    const mid = (a: Date, b: Date) => new Date((a.getTime() + b.getTime()) / 2);
    for (let i = 1; i <= 3; i++)
      await track(websiteId, mid(p.periodStart, p.periodEnd), '/precios', UA(i));
    await track(websiteId, mid(p.prevStart, p.prevEnd), '/', UA(9));

    const create = await api(
      'POST',
      '/aurora/reports',
      {
        name: `Semanal ${RUN}`,
        scope: 'client',
        scopeId: clientId,
        frequency: 'weekly',
        timezone: tz,
        recipients: [`equipo-${RUN}@example.com`],
      },
      admin,
    );
    expect(create.status, JSON.stringify(create.data)).toBe(200);
    expect(new Date(create.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    scheduleId = create.data.id;

    expect(
      (
        await api(
          'POST',
          '/aurora/reports',
          { name: 'x', scope: 'client', frequency: 'weekly' },
          admin,
        )
      ).status,
    ).toBe(400);

    const run = await api('POST', `/aurora/reports/${scheduleId}/run`, { send: true }, admin);
    expect(run.status, JSON.stringify(run.data)).toBe(200);
    expect(run.data.status).toBe('ok');
    expect(run.data.sentTo.sort()).toEqual([clientEmail, `equipo-${RUN}@example.com`].sort());

    const detail = await api('GET', `/aurora/reports/runs/${run.data.runId}`, undefined, admin);
    const snap = detail.data.snapshot;
    expect(snap.scope).toMatchObject({ type: 'client', id: clientId });
    expect(snap.websites).toHaveLength(1);
    expect(snap.totals.current.visitors).toBe(3);
    expect(snap.totals.previous.visitors).toBe(1);
    expect(snap.totals.delta.visitors).toBe(200);
    expect(snap.websites[0].topPages[0]).toMatchObject({
      x: '/precios',
      y: 3,
      prev: 0,
      delta: null,
    });

    const link = await linkFromEmail(clientEmail, '/r/');
    const pub = await api('GET', `/aurora/public/reports?token=${encodeURIComponent(link)}`);
    expect(pub.status).toBe(200);
    expect(pub.data.snapshot.name).toBe(`Semanal ${RUN}`);
    expect((await api('GET', '/aurora/public/reports?token=forged')).status).toBe(404);
  });

  test('cron sends due reports exactly once and reschedules', async () => {
    expect((await api('POST', '/aurora/cron')).status).toBe(401);
    expect((await api('POST', '/aurora/cron', {}, 'wrong-secret-wrong-secret')).status).toBe(401);

    await db.exec(
      `update aurora_report_schedule set next_run_at = now() - interval '1 minute' where schedule_id = $1::uuid`,
      [scheduleId],
    );
    const first = await api('POST', '/aurora/cron', {}, CRON);
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    expect(first.data.reports.map((r: any) => r.scheduleId)).toContain(scheduleId);

    const second = await api('POST', '/aurora/cron', {}, CRON);
    expect(second.data.reports.map((r: any) => r.scheduleId)).not.toContain(scheduleId);

    const sched = await api('GET', `/aurora/reports/${scheduleId}`, undefined, admin);
    expect(new Date(sched.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    const runs = await api('GET', `/aurora/reports/${scheduleId}/runs`, undefined, admin);
    expect(runs.data.data.length).toBe(2);
  });
});

describe('uptime', () => {
  test('worker ingest: two failures open an incident + annotation, success resolves it', async () => {
    const put = await api(
      'PUT',
      `/aurora/uptime/${websiteId}`,
      { url: `https://e2e-${RUN}.aurora.test`, alertEmails: [`ops-${RUN}@example.com`] },
      admin,
    );
    expect(put.status, JSON.stringify(put.data)).toBe(200);

    expect((await api('GET', '/aurora/ingest/uptime')).status).toBe(401);
    const targets = await api('GET', '/aurora/ingest/uptime', undefined, CRON);
    expect(targets.data.data.map((t: any) => t.websiteId)).toContain(websiteId);

    const at = (s: number) => new Date(Date.now() - s * 1000).toISOString();
    const fail = (s: number) => ({
      websiteId,
      checkedAt: at(s),
      ok: false,
      statusCode: 503,
      latencyMs: 120,
      region: 'MEX',
    });

    let r = await api('POST', '/aurora/ingest/uptime', { results: [fail(120)] }, CRON);
    expect(r.data.transitions).toEqual([]);
    r = await api('POST', '/aurora/ingest/uptime', { results: [fail(60)] }, CRON);
    expect(r.data.transitions).toEqual([{ websiteId, transition: 'went_down' }]);

    let summary = await api('GET', '/aurora/uptime', undefined, viewer.token);
    let site = summary.data.data.find((w: any) => w.id === websiteId);
    expect(site.monitor.status).toBe('down');
    expect(site.monitor.incidents[0].resolvedAt).toBeNull();

    const notes = await api(
      'GET',
      `/websites/${websiteId}/annotations?startAt=0&endAt=${Date.now() + 1000}`,
      undefined,
      admin,
    );
    expect(JSON.stringify(notes.data)).toContain('caído');

    r = await api(
      'POST',
      '/aurora/ingest/uptime',
      { results: [{ websiteId, checkedAt: at(1), ok: true, statusCode: 200, latencyMs: 80 }] },
      CRON,
    );
    expect(r.data.transitions).toEqual([{ websiteId, transition: 'recovered' }]);

    summary = await api('GET', '/aurora/uptime', undefined, viewer.token);
    site = summary.data.data.find((w: any) => w.id === websiteId);
    expect(site.monitor.status).toBe('up');
    expect(site.monitor.uptimePct).toBeCloseTo(33.33, 1);
    expect(site.monitor.incidents[0].resolvedAt).not.toBeNull();

    const { rows } = await db.query(
      `select subject from aurora_email_log where $1 = any("to") order by created_at`,
      [`ops-${RUN}@example.com`],
    );
    expect(rows.map(r => r.subject)).toEqual([
      expect.stringContaining('Caído'),
      expect.stringContaining('Recuperado'),
    ]);

    expect(
      (await api('PUT', `/aurora/uptime/${websiteId}`, { url: 'https://x.test' }, viewer.token))
        .status,
    ).toBe(403);
  });
});

describe('members', () => {
  test('removing a member deletes the account', async () => {
    expect(
      (await api('DELETE', `/aurora/members/${viewer.userId}`, undefined, viewer.token)).status,
    ).toBe(403);
    expect((await api('DELETE', `/aurora/members/${viewer.userId}`, undefined, admin)).status).toBe(
      200,
    );
    expect(await login(viewer.username, viewer.password)).toBeNull();
  });

  test('admin cannot remove or demote themselves', async () => {
    const me = await api('GET', '/me', undefined, admin);
    const id = me.data.user?.id ?? me.data.id;
    expect((await api('PATCH', `/aurora/members/${id}`, { role: 'viewer' }, admin)).status).toBe(
      400,
    );
    expect((await api('DELETE', `/aurora/members/${id}`, undefined, admin)).status).toBe(400);
  });
});

describe('public pages', () => {
  test('invite, forgot, reset and report pages render', async () => {
    for (const path of ['/forgot', '/invite/abc', '/reset/abc', '/r/abc', '/login']) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.status, path).toBe(200);
    }
  });
});
