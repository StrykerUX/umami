/**
 * Aurora Status healthcheck, end to end (format: https://status.aurora33.org/healthcheck).
 * Runs against the server started by scripts/aurora-e2e.ts, plus a second server whose
 * database is unreachable, to prove `down` → 503 within 5 seconds.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const BASE = (process.env.AURORA_E2E_URL || 'http://localhost:3100').replace(/\/$/, '');
const TOKEN = process.env.AURORA_HEALTH_TOKEN || '';
const CRON = process.env.AURORA_CRON_SECRET || '';
const KEYS = ['db', 'migrations', 'cron', 'uptime_worker', 'email', 'reports', 'monitors'];

async function health(base = BASE, auth?: string) {
  const res = await fetch(`${base}/api/aurora/health`, {
    redirect: 'manual',
    headers: auth ? { authorization: auth } : {},
  });

  return { status: res.status, headers: res.headers, data: await res.json() };
}

async function waitFor(target: string, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(target)).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

describe('Aurora health (Aurora Status format)', () => {
  test('without token: only the overall status, no-store, never 401 or redirect', async () => {
    const r = await health();

    expect([200, 503]).toContain(r.status);
    expect(Object.keys(r.data)).toEqual(['status']);
    expect(['ok', 'degraded', 'down']).toContain(r.data.status);
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  test('wrong token: same shape as no token', async () => {
    const r = await health(BASE, 'Bearer not-the-right-token-123456');

    expect(r.status).not.toBe(401);
    expect(Object.keys(r.data)).toEqual(['status']);
  });

  test('right token: per-check detail with stable keys; status matches HTTP code', async () => {
    expect(TOKEN.length).toBeGreaterThanOrEqual(16);

    // Make sure the cron heartbeat exists, then read the detail.
    const cron = await fetch(`${BASE}/api/aurora/cron`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON}` },
    });
    expect(cron.status).toBe(200);

    const r = await health(BASE, `Bearer ${TOKEN}`);

    expect(r.data.checks.map((c: any) => c.key)).toEqual(KEYS);
    expect(r.status).toBe(r.data.status === 'down' ? 503 : 200);

    const check = (key: string) => r.data.checks.find((c: any) => c.key === key);
    expect(check('db')).toMatchObject({ status: 'ok', label: 'Base de datos' });
    expect(check('db').latencyMs).toBeTypeOf('number');
    expect(check('cron').status).toBe('ok');
    expect(check('migrations').status).toBe('ok');
    expect(r.data.version.deployedAt).toBeTruthy();

    for (const c of r.data.checks) {
      expect(['ok', 'degraded', 'down']).toContain(c.status);
      if (c.detail) {
        expect(c.detail.length).toBeLessThanOrEqual(120);
        expect(c.detail).not.toMatch(/@/);
      }
    }
  });

  test('admin details route requires an Aurora admin', async () => {
    const anon = await fetch(`${BASE}/api/aurora/health/details`);
    expect(anon.status).toBe(401);

    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: process.env.AURORA_E2E_ADMIN_PASSWORD || 'umami',
      }),
    });
    const { token } = await login.json();
    const r = await fetch(`${BASE}/api/aurora/health/details`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(r.status).toBe(200);
    expect((await r.json()).checks.map((c: any) => c.key)).toEqual(KEYS);
  });
});

describe('Aurora health with the database down', () => {
  const port = String(Number(new URL(BASE).port || 3100) + 1);
  const base = `http://localhost:${port}`;
  let server: ChildProcess;

  beforeAll(async () => {
    const prod = existsSync('.next/BUILD_ID') && process.env.AURORA_E2E_DEV !== '1';
    server = spawn('npx', ['next', prod ? 'start' : 'dev', '-p', port], {
      env: {
        ...process.env,
        PORT: port,
        // Nothing listens on port 1: connections fail.
        DATABASE_URL: 'postgresql://umami:umami@127.0.0.1:1/umami',
        CI: '1',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: 'ignore',
      detached: true,
    });
    await waitFor(`${base}/api/heartbeat`);
    // Warm the route (dev mode compiles on first hit).
    await health(base).catch(() => {});
  }, 240000);

  afterAll(() => {
    try {
      if (server?.pid) process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });

  test('responds 503 down in under 5 seconds, platform heartbeat stays 200', async () => {
    const started = Date.now();
    const r = await health(base, `Bearer ${TOKEN}`);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(5000);
    expect(r.status).toBe(503);
    expect(r.data.status).toBe('down');
    expect(r.data.checks.find((c: any) => c.key === 'db').status).toBe('down');

    const heartbeat = await fetch(`${base}/api/heartbeat`);
    expect(heartbeat.status).toBe(200);
  });
});
