import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));

import {
  formatAge,
  type HealthSource,
  healthTokenMatches,
  httpStatusFor,
  runHealthChecks,
  sanitizeDetail,
  worstStatus,
} from '../lib/health';

const NOW = new Date('2026-11-27T12:00:00Z');
const min = (n: number) => new Date(NOW.getTime() - n * 60_000);

function source(overrides: Partial<HealthSource> = {}): HealthSource {
  return {
    pingDb: async () => {},
    migrations: async () => ({ applied: 28, failed: 0, expected: 28 }),
    cronLastRunAt: async () => min(5),
    monitors: async () => ({ enabled: 2, up: 2, down: 0, lastCheckedAt: min(1) }),
    emailFailuresSince: async () => 0,
    overdueReports: async () => 0,
    ...overrides,
  };
}

const byKey = (report: Awaited<ReturnType<typeof runHealthChecks>>, key: string) =>
  report.checks.find(c => c.key === key) as NonNullable<(typeof report.checks)[number]>;

describe('health rules', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('overall status is the worst check', () => {
    expect(worstStatus(['ok', 'ok'])).toBe('ok');
    expect(worstStatus(['ok', 'degraded'])).toBe('degraded');
    expect(worstStatus(['degraded', 'down', 'ok'])).toBe('down');
    expect(httpStatusFor('ok')).toBe(200);
    expect(httpStatusFor('degraded')).toBe(200);
    expect(httpStatusFor('down')).toBe(503);
  });

  it('all healthy → ok, with stable keys and Spanish labels', async () => {
    const report = await runHealthChecks({ source: source(), now: NOW });

    expect(report.status).toBe('ok');
    expect(report.checks.map(c => c.key)).toEqual([
      'db',
      'migrations',
      'cron',
      'uptime_worker',
      'email',
      'reports',
      'monitors',
    ]);
    expect(report.checks.length).toBeLessThanOrEqual(20);
    expect(byKey(report, 'db').latencyMs).toBeTypeOf('number');
    expect(byKey(report, 'cron').checkedAt).toBe(min(5).toISOString());
    expect(byKey(report, 'monitors').detail).toBe('2 de 2 arriba');
    expect(report.version.deployedAt).toMatch(/Z$/);
  });

  it('database failure → down', async () => {
    const report = await runHealthChecks({
      source: source({
        pingDb: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.1:5432 password=secret');
        },
      }),
      now: NOW,
    });

    expect(report.status).toBe('down');
    expect(byKey(report, 'db')).toMatchObject({ status: 'down', detail: 'No se pudo evaluar' });
    // Error traces never leak into detail.
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
  });

  it('a hanging check times out instead of hanging the response', async () => {
    const started = Date.now();
    const report = await runHealthChecks({
      source: source({ pingDb: () => new Promise(() => {}) }),
      now: NOW,
      timeoutMs: 50,
    });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(byKey(report, 'db')).toMatchObject({ status: 'down', detail: 'Sin respuesta en 0.1 s' });
  });

  it('cron thresholds: 30 min degraded, 2 h down, missing degraded', async () => {
    const at = async (date: Date | null) =>
      byKey(
        await runHealthChecks({ source: source({ cronLastRunAt: async () => date }), now: NOW }),
        'cron',
      );

    expect((await at(min(29))).status).toBe('ok');
    expect(await at(min(41))).toMatchObject({ status: 'degraded', detail: 'hace 41 min' });
    expect((await at(min(121))).status).toBe('down');
    expect(await at(null)).toMatchObject({
      status: 'degraded',
      detail: 'Sin ejecuciones registradas',
    });
  });

  it('uptime worker stale → degraded; no monitors → ok', async () => {
    const stale = await runHealthChecks({
      source: source({
        monitors: async () => ({ enabled: 3, up: 2, down: 1, lastCheckedAt: min(12) }),
      }),
      now: NOW,
    });

    expect(byKey(stale, 'uptime_worker').status).toBe('degraded');
    // A client site being down is informational only.
    expect(byKey(stale, 'monitors')).toMatchObject({
      status: 'ok',
      detail: '2 de 3 arriba, 1 caído(s)',
    });

    const none = await runHealthChecks({
      source: source({
        monitors: async () => ({ enabled: 0, up: 0, down: 0, lastCheckedAt: null }),
      }),
      now: NOW,
    });

    expect(byKey(none, 'uptime_worker')).toMatchObject({ status: 'ok' });
  });

  it('email: missing provider or many failures → degraded', async () => {
    delete process.env.RESEND_API_KEY;
    expect(byKey(await runHealthChecks({ source: source(), now: NOW }), 'email').status).toBe(
      'degraded',
    );

    process.env.RESEND_API_KEY = 're_test';
    const failing = await runHealthChecks({
      source: source({ emailFailuresSince: async () => 4 }),
      now: NOW,
    });

    expect(byKey(failing, 'email')).toMatchObject({
      status: 'degraded',
      detail: '4 envíos fallidos en 24 h',
    });
  });

  it('migrations pending or failed, and overdue reports → degraded', async () => {
    const report = await runHealthChecks({
      source: source({
        migrations: async () => ({ applied: 27, failed: 0, expected: 28 }),
        overdueReports: async () => 2,
      }),
      now: NOW,
    });

    expect(byKey(report, 'migrations')).toMatchObject({
      status: 'degraded',
      detail: '1 pendiente(s)',
    });
    expect(byKey(report, 'reports').status).toBe('degraded');
    expect(report.status).toBe('degraded');

    const failed = await runHealthChecks({
      source: source({ migrations: async () => ({ applied: 28, failed: 1, expected: 28 }) }),
      now: NOW,
    });

    expect(byKey(failed, 'migrations').status).toBe('degraded');
  });

  it('sanitizes detail: no emails, ≤120 chars', () => {
    expect(sanitizeDetail('falló para ana@cliente.com')).toBe('falló para [email]');
    expect(sanitizeDetail('x'.repeat(300))?.length).toBe(120);
    expect(sanitizeDetail(undefined)).toBeUndefined();
  });

  it('formats ages in Spanish', () => {
    expect(formatAge(30_000)).toBe('hace menos de 1 min');
    expect(formatAge(41 * 60_000)).toBe('hace 41 min');
    expect(formatAge(5 * 3_600_000)).toBe('hace 5 h');
    expect(formatAge(72 * 3_600_000)).toBe('hace 3 días');
  });
});

describe('healthTokenMatches', () => {
  const env = { ...process.env };
  const req = (auth?: string) =>
    new Request('http://x/api/aurora/health', auth ? { headers: { authorization: auth } } : {});

  afterEach(() => {
    process.env = { ...env };
  });

  it('never matches when the variable is missing or too short', () => {
    delete process.env.AURORA_HEALTH_TOKEN;
    expect(healthTokenMatches(req('Bearer anything'))).toBe(false);
    expect(healthTokenMatches(req('Bearer '))).toBe(false);

    process.env.AURORA_HEALTH_TOKEN = 'short';
    expect(healthTokenMatches(req('Bearer short'))).toBe(false);
  });

  it('matches only the exact Bearer token', () => {
    process.env.AURORA_HEALTH_TOKEN = 'health-token-0123456789';

    expect(healthTokenMatches(req('Bearer health-token-0123456789'))).toBe(true);
    expect(healthTokenMatches(req('Bearer health-token-012345678'))).toBe(false);
    expect(healthTokenMatches(req('health-token-0123456789'))).toBe(false);
    expect(healthTokenMatches(req())).toBe(false);
  });
});
