/**
 * Aurora OAuth (MCP connectors such as claude.ai), end to end against a live server:
 * discovery → dynamic registration → consent → code + PKCE → MCP calls → refresh rotation →
 * revocation, plus the attacks each step must stop.
 * The server runs with MCP_ENABLED=1 and APP_URL=AURORA_E2E_URL (scripts/aurora-e2e.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import prisma from '@/lib/prisma';

const BASE = (process.env.AURORA_E2E_URL || 'http://localhost:3100').replace(/\/$/, '');
const RUN = `oa${Date.now().toString(36)}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

type Res = { status: number; data: any; headers: Headers };

async function request(
  method: string,
  url: string,
  body?: any,
  token?: string,
  form = false,
): Promise<Res> {
  const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

const api = (method: string, path: string, body?: any, token?: string) =>
  request(method, `/api${path}`, body, token);

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function mcpList(token: string) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-method': 'tools/list',
      'mcp-protocol-version': '2026-07-28',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'oauth-e2e', version: '1.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => JSON.parse(l.slice(5)))
      .find(m => m.id === 1);
  }
  return { status: res.status, headers: res.headers, body };
}

async function linkFromEmail(to: string, pathPrefix: string) {
  const rows = (await prisma.client.$queryRawUnsafe(
    `select html from aurora_email_log where $1 = any("to") order by created_at desc limit 1`,
    to,
  )) as any[];
  const match = rows[0]?.html.match(new RegExp(`https?://[^"\\s]*${pathPrefix}([^"\\s<]+)`));
  expect(match, `no ${pathPrefix} link for ${to}`).toBeTruthy();
  return decodeURIComponent(match[1]);
}

async function invite(admin: string, role: 'viewer' | 'editor', name: string) {
  const email = `${name}-${RUN}@example.com`;
  const inv = await api('POST', '/aurora/invites', { kind: 'email', email, role }, admin);
  expect(inv.status, JSON.stringify(inv.data)).toBe(200);
  const password = `${name}-${RUN}-Pass!`;
  const accept = await api('POST', '/aurora/invites/accept', {
    token: await linkFromEmail(email, '/invite/'),
    username: `${name}_${RUN}`,
    password,
    displayName: name,
  });
  expect(accept.status, JSON.stringify(accept.data)).toBe(200);
  return { token: accept.data.token as string, userId: accept.data.user.id as string, password };
}

let admin: string;
let viewer: { token: string; userId: string; password: string };
let other: { token: string; userId: string; password: string };
let clientId: string;

/** Consent (as `session`) + code exchange. Returns tokens. */
async function connect(session: string) {
  const { verifier, challenge } = pkce();
  const state = randomBytes(8).toString('hex');
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: `${BASE}/mcp`,
    scope: 'mcp',
  };
  const approve = await api(
    'POST',
    '/aurora/oauth/authorize',
    { ...params, decision: 'approve' },
    session,
  );
  expect(approve.status, JSON.stringify(approve.data)).toBe(200);
  const url = new URL(approve.data.redirectUrl);
  expect(url.origin + url.pathname).toBe(REDIRECT);
  expect(url.searchParams.get('state')).toBe(state);
  expect(url.searchParams.get('iss')).toBe(BASE);
  const code = url.searchParams.get('code') as string;
  const tokens = await request(
    'POST',
    '/api/aurora/oauth/token',
    {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: `${BASE}/mcp`,
    },
    undefined,
    true,
  );
  expect(tokens.status, JSON.stringify(tokens.data)).toBe(200);
  return { ...tokens.data, code, verifier };
}

beforeAll(async () => {
  const login = await api('POST', '/auth/login', {
    username: 'admin',
    password: process.env.AURORA_E2E_ADMIN_PASSWORD || 'umami',
  });
  expect(login.status).toBe(200);
  admin = login.data.token;
  viewer = await invite(admin, 'viewer', 'oaviewer');
  other = await invite(admin, 'viewer', 'oaother');
});

afterAll(async () => {
  await prisma.client.$disconnect();
});

describe('Aurora OAuth: discovery', () => {
  test('metadata documents use APP_URL as issuer', async () => {
    const asRes = await request('GET', '/.well-known/oauth-authorization-server');
    expect(asRes.status).toBe(200);
    expect(asRes.data.issuer).toBe(BASE);
    expect(asRes.data.code_challenge_methods_supported).toEqual(['S256']);
    expect(asRes.data.registration_endpoint).toBe(`${BASE}/api/aurora/oauth/register`);

    const pr = await request('GET', '/.well-known/oauth-protected-resource/mcp');
    expect(pr.status).toBe(200);
    expect(pr.data.resource).toBe(`${BASE}/mcp`);
    expect(pr.data.authorization_servers).toEqual([BASE]);
  });

  test('issuer ignores spoofed Host / X-Forwarded-Host headers', async () => {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`, {
      headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
    });
    expect((await res.json()).issuer).toBe(BASE);
  });

  test('unauthenticated MCP call advertises resource metadata', async () => {
    const res = await mcpList('');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`,
    );
  });
});

describe('Aurora OAuth: registration', () => {
  test('rejects redirect URIs outside the allowlist', async () => {
    for (const uri of [
      'https://evil.example/cb',
      'http://claude.ai/cb',
      'myapp://cb',
      'https://claude.ai.evil.example/cb',
      'https://claude.ai/some/other/path',
      'https://claude.ai:8443/api/mcp/auth_callback',
    ]) {
      const r = await api('POST', '/aurora/oauth/register', {
        client_name: 'Evil',
        redirect_uris: [uri],
      });
      expect(r.status, uri).toBe(400);
      expect(r.data.error).toBe('invalid_redirect_uri');
    }
  });

  test('registers a public client and never issues a secret', async () => {
    const r = await api('POST', '/aurora/oauth/register', {
      client_name: 'Claude',
      redirect_uris: [REDIRECT, 'http://127.0.0.1:33418/callback'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.token_endpoint_auth_method).toBe('none');
    expect(r.data.client_secret).toBeUndefined();
    expect(r.headers.get('cache-control')).toContain('no-store');
    clientId = r.data.client_id;
  });
});

describe('Aurora OAuth: consent', () => {
  const base = () => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: pkce().challenge,
    code_challenge_method: 'S256',
  });

  test('requires an interactive session (not anonymous, not an API key)', async () => {
    const anon = await api('GET', `/aurora/oauth/authorize?${new URLSearchParams(base())}`);
    expect(anon.status).toBe(401);

    const key = await api('POST', '/me/api-keys', { name: `oa-${RUN}` }, viewer.token);
    expect(key.status).toBe(200);
    const withKey = await api(
      'GET',
      `/aurora/oauth/authorize?${new URLSearchParams(base())}`,
      undefined,
      key.data.key,
    );
    expect(withKey.status).toBe(401);
  });

  test('blocks accounts still on the default password', async () => {
    const r = await api(
      'GET',
      `/aurora/oauth/authorize?${new URLSearchParams(base())}`,
      undefined,
      admin,
    );
    expect(r.status).toBe(403);
  });

  test('shows the client and redirect host; validates every parameter', async () => {
    const ok = await api(
      'GET',
      `/aurora/oauth/authorize?${new URLSearchParams(base())}`,
      undefined,
      viewer.token,
    );
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(ok.data).toMatchObject({
      client: { name: 'Claude' },
      redirectHost: 'claude.ai',
      user: { role: 'viewer' },
    });

    const cases: [Record<string, string>, string][] = [
      [{ redirect_uri: 'https://claude.ai/other' }, 'invalid_redirect_uri'],
      [{ code_challenge: '' }, 'invalid_request'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ resource: 'https://evil.example/mcp' }, 'invalid_target'],
      [{ client_id: '00000000-0000-4000-8000-000000000000' }, 'invalid_client'],
      [{ client_id: 'https://evil.example/client.json' }, 'invalid_client'],
    ];
    for (const [override, error] of cases) {
      const r = await api(
        'GET',
        `/aurora/oauth/authorize?${new URLSearchParams({ ...base(), ...override })}`,
        undefined,
        viewer.token,
      );
      expect(r.data.error, JSON.stringify(override)).toBe(error);
    }
  });

  test('deny redirects back with access_denied and state', async () => {
    const r = await api(
      'POST',
      '/aurora/oauth/authorize',
      { ...base(), state: 'xyz', decision: 'deny' },
      viewer.token,
    );
    const url = new URL(r.data.redirectUrl);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.has('code')).toBe(false);
  });

  test('consent page renders and cannot be framed', async () => {
    const res = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams(base())}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('Aurora OAuth: tokens and MCP', () => {
  test('full flow: tokens work on MCP as the user, with Aurora tools', async () => {
    const t = await connect(viewer.token);
    expect(t.access_token).toMatch(/^aat_/);
    expect(t.refresh_token).toMatch(/^art_/);
    expect(t.token_type).toBe('Bearer');

    // The account owner is told by email that an app was connected.
    const mails = (await prisma.client.$queryRawUnsafe(
      `select subject from aurora_email_log where kind = 'oauth_grant' and $1 = any("to")`,
      `oaviewer-${RUN}@example.com`,
    )) as any[];
    expect(mails.length).toBeGreaterThan(0);

    const list = await mcpList(t.access_token);
    expect(list.status).toBe(200);
    const names = list.body.result.tools.map((tool: any) => tool.name);
    expect(names).toContain('aurora_list_clients');
    expect(names).toContain('list_websites');

    // The token is only valid on MCP; it is not an API credential.
    const direct = await api('GET', '/aurora/me', undefined, t.access_token);
    expect(direct.status).toBe(401);
  });

  test('wrong PKCE verifier fails and burns the code', async () => {
    const { verifier, challenge } = pkce();
    const approve = await api(
      'POST',
      '/aurora/oauth/authorize',
      {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        decision: 'approve',
      },
      viewer.token,
    );
    const code = new URL(approve.data.redirectUrl).searchParams.get('code') as string;
    const exchange = (v: string) =>
      request(
        'POST',
        '/api/aurora/oauth/token',
        {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_verifier: v,
        },
        undefined,
        true,
      );

    const bad = await exchange(pkce().verifier);
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe('invalid_grant');
    expect((await exchange(verifier)).data.error).toBe('invalid_grant');
  });

  test('code replay revokes the grant it produced', async () => {
    const t = await connect(viewer.token);
    expect((await mcpList(t.access_token)).status).toBe(200);

    const replay = await request(
      'POST',
      '/api/aurora/oauth/token',
      {
        grant_type: 'authorization_code',
        code: t.code,
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_verifier: t.verifier,
      },
      undefined,
      true,
    );
    expect(replay.data.error).toBe('invalid_grant');
    expect((await mcpList(t.access_token)).status).toBe(401);
  });

  test('refresh rotates; immediate retry fails softly; later reuse kills the grant', async () => {
    const t = await connect(viewer.token);
    const refresh = (token: string) =>
      request(
        'POST',
        '/api/aurora/oauth/token',
        { grant_type: 'refresh_token', refresh_token: token, client_id: clientId },
        undefined,
        true,
      );

    const r1 = await refresh(t.refresh_token);
    expect(r1.status, JSON.stringify(r1.data)).toBe(200);
    expect(r1.data.refresh_token).not.toBe(t.refresh_token);
    expect((await mcpList(r1.data.access_token)).status).toBe(200);

    // Retry within the grace window (lost response): rejected, but the connection survives.
    expect((await refresh(t.refresh_token)).data.error).toBe('invalid_grant');
    expect((await mcpList(r1.data.access_token)).status).toBe(200);

    // Same token replayed later: treated as theft, whole grant revoked.
    const hash = createHash('sha256').update(t.refresh_token).digest('hex');
    await prisma.client.$executeRawUnsafe(
      `update aurora_oauth_token set used_at = now() - interval '5 minutes' where token_hash = $1`,
      hash,
    );
    expect((await refresh(t.refresh_token)).data.error).toBe('invalid_grant');
    expect((await mcpList(r1.data.access_token)).status).toBe(401);
    expect((await refresh(r1.data.refresh_token)).data.error).toBe('invalid_grant');
  });

  test('refresh requires the matching client_id', async () => {
    const t = await connect(viewer.token);
    const r = await request(
      'POST',
      '/api/aurora/oauth/token',
      {
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: '00000000-0000-4000-8000-000000000000',
      },
      undefined,
      true,
    );
    expect(r.data.error).toBe('invalid_grant');
  });

  test('revocation endpoint (RFC 7009) revokes the grant', async () => {
    const t = await connect(viewer.token);
    const r = await request(
      'POST',
      '/api/aurora/oauth/revoke',
      { token: t.refresh_token },
      undefined,
      true,
    );
    expect(r.status).toBe(200);
    expect((await mcpList(t.access_token)).status).toBe(401);

    const unknown = await request(
      'POST',
      '/api/aurora/oauth/revoke',
      { token: 'nope' },
      undefined,
      true,
    );
    expect(unknown.status).toBe(200);
  });

  test('connected apps: own list, no cross-user revoke, admin sees all', async () => {
    const t = await connect(viewer.token);
    const mine = await api('GET', '/aurora/oauth/grants', undefined, viewer.token);
    expect(mine.status).toBe(200);
    expect(mine.data.data.every((g: any) => g.userId === viewer.userId)).toBe(true);
    const grant = mine.data.data[0];

    const theirs = await api('DELETE', `/aurora/oauth/grants/${grant.id}`, undefined, other.token);
    expect(theirs.status).toBe(404);
    expect((await mcpList(t.access_token)).status).toBe(200);

    const all = await api('GET', '/aurora/oauth/grants?all=1', undefined, admin);
    expect(all.data.data.some((g: any) => g.id === grant.id)).toBe(true);
    const otherAll = await api('GET', '/aurora/oauth/grants?all=1', undefined, other.token);
    expect(otherAll.data.data.every((g: any) => g.userId === other.userId)).toBe(true);

    for (const g of mine.data.data) {
      expect(
        (await api('DELETE', `/aurora/oauth/grants/${g.id}`, undefined, viewer.token)).status,
      ).toBe(200);
    }
    expect((await mcpList(t.access_token)).status).toBe(401);
  });

  test('a password change invalidates OAuth access', async () => {
    const t = await connect(other.token);
    expect((await mcpList(t.access_token)).status).toBe(200);

    const change = await api(
      'POST',
      '/me/password',
      { currentPassword: other.password, newPassword: `${other.password}-2` },
      other.token,
    );
    expect(change.status, JSON.stringify(change.data)).toBe(200);
    expect((await mcpList(t.access_token)).status).toBe(401);
  });

  test('tokens are stored only as hashes', async () => {
    const rows = (await prisma.client.$queryRawUnsafe(
      `select token_hash from aurora_oauth_token limit 50`,
    )) as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
