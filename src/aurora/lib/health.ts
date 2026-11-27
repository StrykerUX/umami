import { createHash, timingSafeEqual } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import prisma from '@/lib/prisma';

/**
 * Health report in the Aurora Status format (https://status.aurora33.org/healthcheck).
 * Read-only: nothing here writes to the database. The cron records its own heartbeat
 * through `recordCronRun`, which is called by the cron endpoint, never by the health check.
 */

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail?: string;
  latencyMs?: number;
  checkedAt?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheck[];
  version: { commit?: string; deployedAt?: string };
}

export const SETTING_CRON_LAST_RUN = 'aurora.cron.lastRunAt';
export const CHECK_TIMEOUT_MS = 1500;
export const MAX_CHECKS = 20;

export const THRESHOLDS = {
  dbSlowMs: 500,
  cronDegradedMin: 30,
  cronDownMin: 120,
  workerDegradedMin: 5,
  emailFailures24h: 3,
  reportOverdueMin: 60,
} as const;

const RANK: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };
const MINUTE = 60_000;
const PROCESS_STARTED_AT = new Date();

export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'ok');
}

export function httpStatusFor(status: HealthStatus) {
  return status === 'down' ? 503 : 200;
}

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Keeps `detail` to one short, non-sensitive sentence (≤120 chars, no emails). */
export function sanitizeDetail(detail?: string) {
  if (!detail) return undefined;

  const clean = detail.replace(EMAIL_RE, '[email]').replace(/\s+/g, ' ').trim();

  return clean.length > 120 ? `${clean.slice(0, 119)}…` : clean;
}

export function formatAge(ms: number) {
  const min = Math.max(0, Math.floor(ms / MINUTE));

  if (min < 1) return 'hace menos de 1 min';
  if (min < 120) return `hace ${min} min`;

  const hours = Math.floor(min / 60);

  if (hours < 48) return `hace ${hours} h`;

  return `hace ${Math.floor(hours / 24)} días`;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Data access used by the checks. Swappable in tests. */
export interface HealthSource {
  pingDb(): Promise<void>;
  migrations(): Promise<{ applied: number; failed: number; expected: number | null }>;
  cronLastRunAt(): Promise<Date | null>;
  monitors(): Promise<{ enabled: number; up: number; down: number; lastCheckedAt: Date | null }>;
  emailFailuresSince(since: Date): Promise<number>;
  overdueReports(before: Date): Promise<number>;
}

let migrationsOnDisk: { value: number | null; at: number } | null = null;

async function countMigrationsOnDisk() {
  // Reading the directory is the only costly part; cache it for 60 s.
  if (migrationsOnDisk && Date.now() - migrationsOnDisk.at < 60_000) {
    return migrationsOnDisk.value;
  }

  let value: number | null = null;

  try {
    const dir = path.join(process.cwd(), 'prisma', 'migrations');
    const entries = await readdir(dir, { withFileTypes: true });
    value = entries.filter(e => e.isDirectory()).length;
  } catch {
    value = null;
  }

  migrationsOnDisk = { value, at: Date.now() };

  return value;
}

export const prismaHealthSource: HealthSource = {
  async pingDb() {
    await prisma.client.$queryRawUnsafe('select 1');
  },

  async migrations() {
    const rows: any[] = await prisma.client.$queryRawUnsafe(
      `select
         count(*) filter (where finished_at is not null and rolled_back_at is null)::int as applied,
         count(*) filter (where finished_at is null and rolled_back_at is null)::int as failed
       from _prisma_migrations`,
    );

    return {
      applied: Number(rows[0]?.applied ?? 0),
      failed: Number(rows[0]?.failed ?? 0),
      expected: await countMigrationsOnDisk(),
    };
  },

  async cronLastRunAt() {
    const row = await prisma.client.appSetting.findUnique({
      where: { key: SETTING_CRON_LAST_RUN },
    });
    const date = row?.value ? new Date(row.value) : null;

    return date && !Number.isNaN(date.getTime()) ? date : null;
  },

  async monitors() {
    const list = await prisma.client.auroraMonitor.findMany({
      where: { enabled: true },
      select: { status: true, lastCheckedAt: true },
    });
    let last: Date | null = null;

    for (const m of list) {
      if (m.lastCheckedAt && (!last || m.lastCheckedAt > last)) last = m.lastCheckedAt;
    }

    return {
      enabled: list.length,
      up: list.filter(m => m.status === 'up').length,
      down: list.filter(m => m.status === 'down').length,
      lastCheckedAt: last,
    };
  },

  async emailFailuresSince(since) {
    return prisma.client.auroraEmailLog.count({
      where: { status: 'failed', createdAt: { gte: since } },
    });
  },

  async overdueReports(before) {
    return prisma.client.auroraReportSchedule.count({
      where: { active: true, nextRunAt: { lt: before } },
    });
  },
};

type Evaluated = Omit<HealthCheck, 'key' | 'label'>;

interface CheckSpec {
  key: string;
  label: string;
  /** Status reported when the check errors or times out. */
  onFailure: HealthStatus;
  run: () => Promise<Evaluated>;
}

async function runCheck(spec: CheckSpec, timeoutMs: number): Promise<HealthCheck> {
  const started = Date.now();

  try {
    const result = await withTimeout(spec.run(), timeoutMs);

    return {
      key: spec.key,
      label: spec.label,
      ...result,
      detail: sanitizeDetail(result.detail),
    };
  } catch (e) {
    return {
      key: spec.key,
      label: spec.label,
      status: spec.onFailure,
      detail:
        e instanceof TimeoutError
          ? `Sin respuesta en ${(timeoutMs / 1000).toFixed(1)} s`
          : 'No se pudo evaluar',
      latencyMs: Date.now() - started,
    };
  }
}

export function getVersion(): HealthReport['version'] {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA;

  return {
    ...(sha ? { commit: sha.slice(0, 7) } : {}),
    deployedAt: PROCESS_STARTED_AT.toISOString(),
  };
}

export async function runHealthChecks(
  options: { source?: HealthSource; now?: Date; timeoutMs?: number } = {},
): Promise<HealthReport> {
  const source = options.source ?? prismaHealthSource;
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const ago = (date: Date) => now.getTime() - date.getTime();

  const specs: CheckSpec[] = [
    {
      key: 'db',
      label: 'Base de datos',
      onFailure: 'down',
      run: async () => {
        const started = Date.now();
        await source.pingDb();
        const latencyMs = Date.now() - started;

        return latencyMs > THRESHOLDS.dbSlowMs
          ? { status: 'degraded', detail: 'Respuesta lenta', latencyMs }
          : { status: 'ok', latencyMs };
      },
    },
    {
      key: 'migrations',
      label: 'Migraciones',
      onFailure: 'degraded',
      run: async () => {
        const { applied, failed, expected } = await source.migrations();

        if (failed > 0) {
          return { status: 'degraded', detail: `${failed} migración(es) fallida(s)` };
        }

        if (expected !== null && expected > applied) {
          return { status: 'degraded', detail: `${expected - applied} pendiente(s)` };
        }

        return { status: 'ok', detail: `${applied} aplicadas` };
      },
    },
    {
      key: 'cron',
      label: 'Último cron',
      onFailure: 'degraded',
      run: async () => {
        const last = await source.cronLastRunAt();

        if (!last) {
          return { status: 'degraded', detail: 'Sin ejecuciones registradas' };
        }

        const age = ago(last);
        const status: HealthStatus =
          age > THRESHOLDS.cronDownMin * MINUTE
            ? 'down'
            : age > THRESHOLDS.cronDegradedMin * MINUTE
              ? 'degraded'
              : 'ok';

        return { status, detail: formatAge(age), checkedAt: last.toISOString() };
      },
    },
    {
      key: 'uptime_worker',
      label: 'Worker de uptime',
      onFailure: 'degraded',
      run: async () => {
        const { enabled, lastCheckedAt } = await source.monitors();

        if (enabled === 0) {
          return { status: 'ok', detail: 'Sin sitios monitoreados' };
        }

        if (!lastCheckedAt) {
          return { status: 'degraded', detail: 'Aún sin revisiones' };
        }

        const age = ago(lastCheckedAt);

        return {
          status: age > THRESHOLDS.workerDegradedMin * MINUTE ? 'degraded' : 'ok',
          detail: `Última revisión ${formatAge(age)}`,
          checkedAt: lastCheckedAt.toISOString(),
        };
      },
    },
    {
      key: 'email',
      label: 'Correo',
      onFailure: 'degraded',
      run: async () => {
        const failures = await source.emailFailuresSince(
          new Date(now.getTime() - 24 * 60 * MINUTE),
        );

        if (!process.env.RESEND_API_KEY) {
          return { status: 'degraded', detail: 'Proveedor sin configurar; no se envían correos' };
        }

        if (failures > THRESHOLDS.emailFailures24h) {
          return { status: 'degraded', detail: `${failures} envíos fallidos en 24 h` };
        }

        return {
          status: 'ok',
          detail: failures ? `${failures} envíos fallidos en 24 h` : undefined,
        };
      },
    },
    {
      key: 'reports',
      label: 'Reportes programados',
      onFailure: 'degraded',
      run: async () => {
        const overdue = await source.overdueReports(
          new Date(now.getTime() - THRESHOLDS.reportOverdueMin * MINUTE),
        );

        return overdue > 0
          ? { status: 'degraded', detail: `${overdue} reporte(s) atrasado(s)` }
          : { status: 'ok' };
      },
    },
    {
      key: 'monitors',
      label: 'Sitios monitoreados',
      onFailure: 'ok',
      run: async () => {
        const { enabled, up, down } = await source.monitors();

        // Informational only: client sites being down does not affect this service.
        return {
          status: 'ok',
          detail: enabled
            ? `${up} de ${enabled} arriba${down ? `, ${down} caído(s)` : ''}`
            : 'Ninguno',
        };
      },
    },
  ];

  const checks = (await Promise.all(specs.map(spec => runCheck(spec, timeoutMs)))).slice(
    0,
    MAX_CHECKS,
  );

  return {
    status: worstStatus(checks.map(c => c.status)),
    checks,
    version: getVersion(),
  };
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

/** True only when AURORA_HEALTH_TOKEN is set (≥16 chars) and the Bearer token matches. */
export function healthTokenMatches(request: Request) {
  const expected = process.env.AURORA_HEALTH_TOKEN;

  if (!expected || expected.length < 16) {
    return false;
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  // Compare fixed-length digests so neither content nor length leaks through timing.
  return !!token && timingSafeEqual(digest(token), digest(expected));
}

/** Called by the cron endpoint after each run (the health check itself never writes). */
export async function recordCronRun(now = new Date()) {
  await prisma.client.appSetting.upsert({
    where: { key: SETTING_CRON_LAST_RUN },
    create: { key: SETTING_CRON_LAST_RUN, value: now.toISOString() },
    update: { value: now.toISOString() },
  });
}
