import { describe, expect, test, vi } from 'vitest';
import {
  checkTarget,
  runReports,
  runUptime,
  shouldRunReports,
} from '../../../workers/aurora-uptime/src/check';

const env = {
  AURORA_URL: 'https://aurora.test/',
  AURORA_CRON_SECRET: 'secret-secret-secret',
  REGION: 'cf',
};
const target = { websiteId: 'w1', url: 'https://site.test', timeoutMs: 5000 };

function response(status: number, body = 'hello world') {
  return new Response(body, { status });
}

describe('checkTarget', () => {
  test('2xx/3xx are up', async () => {
    let t = 1000;
    const r = await checkTarget(target, {
      fetch: async () => response(200),
      now: () => (t += 50),
      region: 'cf',
    });
    expect(r).toMatchObject({
      websiteId: 'w1',
      ok: true,
      statusCode: 200,
      latencyMs: 50,
      error: null,
      region: 'cf',
    });
  });

  test('4xx/5xx are down with the status as error', async () => {
    const r = await checkTarget(target, { fetch: async () => response(503) });
    expect(r).toMatchObject({ ok: false, statusCode: 503, error: 'HTTP 503' });
  });

  test('keyword must be present', async () => {
    const ok = await checkTarget(
      { ...target, keyword: 'world' },
      { fetch: async () => response(200) },
    );
    expect(ok.ok).toBe(true);
    const missing = await checkTarget(
      { ...target, keyword: 'Comprar' },
      { fetch: async () => response(200) },
    );
    expect(missing).toMatchObject({ ok: false, statusCode: 200 });
    expect(missing.error).toContain('Comprar');
  });

  test('network errors and timeouts are down', async () => {
    const net = await checkTarget(target, {
      fetch: async () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(net).toMatchObject({ ok: false, statusCode: null, error: 'ECONNREFUSED' });

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const slow = await checkTarget(target, { fetch: async () => Promise.reject(abort) });
    expect(slow.error).toBe('Timeout (5000 ms)');
  });
});

test('runUptime fetches targets, checks them and posts results with the secret', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/aurora/ingest/uptime') && !init?.method) {
      return Response.json({
        data: [target, { ...target, websiteId: 'w2', url: 'https://down.test' }],
      });
    }
    if (url === 'https://site.test') return response(200);
    if (url === 'https://down.test') return response(500);
    return Response.json({ transitions: [{ websiteId: 'w2', transition: 'went_down' }] });
  });

  const result = await runUptime(env, fetchMock as any);

  expect(result).toEqual({
    checked: 2,
    transitions: [{ websiteId: 'w2', transition: 'went_down' }],
  });
  const post = calls.find(c => c.init?.method === 'POST');
  expect(post?.url).toBe('https://aurora.test/api/aurora/ingest/uptime');
  const headers = (post?.init?.headers ?? {}) as Record<string, string>;
  expect(headers.authorization).toBe('Bearer secret-secret-secret');
  const body = JSON.parse(post?.init?.body as string);
  expect(body.results.map((r: any) => [r.websiteId, r.ok])).toEqual([
    ['w1', true],
    ['w2', false],
  ]);
});

test('runUptime skips posting when there are no targets', async () => {
  const fetchMock = vi.fn(async () => Response.json({ data: [] }));
  expect(await runUptime(env, fetchMock as any)).toEqual({ checked: 0, transitions: [] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('runReports calls the cron endpoint and surfaces failures', async () => {
  const ok = vi.fn(async () => Response.json({ reports: [], pruned: 0 }));
  expect(await runReports(env, ok as any)).toEqual({ reports: [], pruned: 0 });
  expect((ok.mock.calls[0] as any)[0]).toBe('https://aurora.test/api/aurora/cron');
  await expect(
    runReports(env, (async () => new Response('', { status: 401 })) as any),
  ).rejects.toThrow('401');
});

test('reports trigger every 15 minutes', () => {
  expect(shouldRunReports(Date.UTC(2026, 10, 23, 14, 0))).toBe(true);
  expect(shouldRunReports(Date.UTC(2026, 10, 23, 14, 15))).toBe(true);
  expect(shouldRunReports(Date.UTC(2026, 10, 23, 14, 7))).toBe(false);
});
