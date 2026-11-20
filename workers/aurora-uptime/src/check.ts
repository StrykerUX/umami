/**
 * Aurora uptime + scheduler logic. Dependency-free so it runs on Cloudflare Workers
 * and in the main repo's vitest suite unchanged.
 */
export interface Env {
  AURORA_URL: string;
  AURORA_CRON_SECRET: string;
  REGION?: string;
}

export interface Target {
  websiteId: string;
  url: string;
  timeoutMs: number;
  keyword?: string | null;
}

export interface CheckResult {
  websiteId: string;
  checkedAt: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  region: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const BATCH = 20;
const MAX_BODY_FOR_KEYWORD = 2_000_000;

export async function checkTarget(
  target: Target,
  options: { fetch?: FetchLike; region?: string; now?: () => number } = {},
): Promise<CheckResult> {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, target.timeoutMs || 10000));
  const base = {
    websiteId: target.websiteId,
    checkedAt: new Date(started).toISOString(),
    region: options.region ?? null,
  };

  try {
    const res = await doFetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'AuroraUptime/1.0 (+https://analytics.aurora33.dev)',
        accept: 'text/html,*/*',
      },
    });
    const latencyMs = Math.max(0, now() - started);
    let ok = res.status >= 200 && res.status < 400;
    let error: string | null = ok ? null : `HTTP ${res.status}`;

    if (ok && target.keyword) {
      const text = (await res.text()).slice(0, MAX_BODY_FOR_KEYWORD);
      if (!text.includes(target.keyword)) {
        ok = false;
        error = `Falta el texto "${target.keyword.slice(0, 60)}"`;
      }
    } else {
      // Release the connection without reading large bodies.
      await res.body?.cancel().catch(() => {});
    }

    return { ...base, ok, statusCode: res.status, latencyMs, error };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      ...base,
      ok: false,
      statusCode: null,
      latencyMs: aborted ? Math.max(0, now() - started) : null,
      error: aborted ? `Timeout (${target.timeoutMs} ms)` : String(e?.message ?? e).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

function auroraUrl(env: Env, path: string) {
  return `${env.AURORA_URL.replace(/\/+$/, '')}${path}`;
}

function authHeaders(env: Env) {
  return { authorization: `Bearer ${env.AURORA_CRON_SECRET}`, 'content-type': 'application/json' };
}

export async function runUptime(env: Env, doFetch: FetchLike = fetch) {
  const res = await doFetch(auroraUrl(env, '/api/aurora/ingest/uptime'), {
    headers: authHeaders(env),
  });
  if (!res.ok) throw new Error(`targets: HTTP ${res.status}`);
  const { data: targets } = (await res.json()) as { data: Target[] };

  const results: CheckResult[] = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    results.push(
      ...(await Promise.all(
        batch.map(t => checkTarget(t, { fetch: doFetch, region: env.REGION })),
      )),
    );
  }

  if (!results.length) return { checked: 0, transitions: [] };

  const post = await doFetch(auroraUrl(env, '/api/aurora/ingest/uptime'), {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ results }),
  });
  if (!post.ok) throw new Error(`ingest: HTTP ${post.status}`);
  const body = (await post.json()) as { transitions?: unknown[] };

  return { checked: results.length, transitions: body.transitions ?? [] };
}

export async function runReports(env: Env, doFetch: FetchLike = fetch) {
  const res = await doFetch(auroraUrl(env, '/api/aurora/cron'), {
    method: 'POST',
    headers: authHeaders(env),
    body: '{}',
  });
  if (!res.ok) throw new Error(`cron: HTTP ${res.status}`);
  return res.json();
}

/** Reports run every 15 minutes; uptime every minute. */
export function shouldRunReports(scheduledTime: number) {
  return new Date(scheduledTime).getUTCMinutes() % 15 === 0;
}
