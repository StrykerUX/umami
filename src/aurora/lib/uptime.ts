import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';
import { uptimeAlertEmail } from '../emails/templates';
import { UPTIME_FAILURE_THRESHOLD, UPTIME_RETENTION_DAYS } from './constants';
import { sendMail } from './mailer';

export interface CheckResult {
  websiteId: string;
  checkedAt: string | Date;
  ok: boolean;
  statusCode?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  region?: string | null;
}

export interface MonitorState {
  status: string;
  consecutiveFailures: number;
}

/**
 * Pure state machine. A site goes `down` only after UPTIME_FAILURE_THRESHOLD consecutive
 * failures (avoids alerting on a single blip) and `up` on the first success.
 */
export function nextMonitorState(state: MonitorState, ok: boolean) {
  if (ok) {
    return {
      status: 'up',
      consecutiveFailures: 0,
      transition: state.status === 'down' ? ('recovered' as const) : null,
    };
  }

  const failures = state.consecutiveFailures + 1;
  const isDown = failures >= UPTIME_FAILURE_THRESHOLD;

  return {
    status: isDown ? 'down' : state.status === 'down' ? 'down' : state.status,
    consecutiveFailures: failures,
    transition: isDown && state.status !== 'down' ? ('went_down' as const) : null,
  };
}

export function monitorTargetUrl(domain?: string | null) {
  if (!domain) return null;
  const trimmed = domain.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Monitors the uptime worker should check. */
export async function getUptimeTargets() {
  const monitors = await prisma.client.auroraMonitor.findMany({ where: { enabled: true } });

  return monitors.map(m => ({
    websiteId: m.websiteId,
    url: m.url,
    timeoutMs: m.timeoutMs,
    keyword: m.keyword,
  }));
}

/** Stores worker results, updates monitor state, opens/closes incidents and sends alerts. */
export async function ingestUptimeResults(results: CheckResult[]) {
  const transitions: { websiteId: string; transition: string }[] = [];

  for (const r of results) {
    const monitor = await prisma.client.auroraMonitor.findUnique({
      where: { websiteId: r.websiteId },
    });

    if (!monitor) {
      continue;
    }

    const checkedAt = new Date(r.checkedAt);

    await prisma.client.auroraUptimeCheck.create({
      data: {
        websiteId: r.websiteId,
        checkedAt,
        ok: r.ok,
        statusCode: r.statusCode ?? null,
        latencyMs: r.latencyMs ?? null,
        error: r.error ? String(r.error).slice(0, 500) : null,
        region: r.region ? String(r.region).slice(0, 20) : null,
      },
    });

    const next = nextMonitorState(monitor, r.ok);

    await prisma.client.auroraMonitor.update({
      where: { websiteId: r.websiteId },
      data: {
        status: next.status,
        consecutiveFailures: next.consecutiveFailures,
        lastCheckedAt: checkedAt,
        lastLatencyMs: r.latencyMs ?? null,
        ...(next.transition ? { lastChangeAt: checkedAt } : {}),
      },
    });

    if (!next.transition) {
      continue;
    }

    transitions.push({ websiteId: r.websiteId, transition: next.transition });

    const website = await prisma.client.website.findUnique({
      where: { id: r.websiteId },
      select: { name: true },
    });
    const websiteName = website?.name ?? monitor.url;

    if (next.transition === 'went_down') {
      const annotationId = uuid();

      await prisma.client.annotation.create({
        data: {
          id: annotationId,
          websiteId: r.websiteId,
          date: checkedAt,
          allDay: false,
          note: `🔴 Sitio caído (${r.error || `HTTP ${r.statusCode ?? '—'}`})`.slice(0, 500),
        },
      });
      await prisma.client.auroraIncident.create({
        data: {
          id: uuid(),
          websiteId: r.websiteId,
          startedAt: checkedAt,
          cause: (r.error || `HTTP ${r.statusCode ?? 'sin respuesta'}`).slice(0, 500),
          annotationId,
        },
      });
    } else {
      await prisma.client.auroraIncident.updateMany({
        where: { websiteId: r.websiteId, resolvedAt: null },
        data: { resolvedAt: checkedAt },
      });
      await prisma.client.annotation.create({
        data: {
          id: uuid(),
          websiteId: r.websiteId,
          date: checkedAt,
          allDay: false,
          note: '🟢 Sitio recuperado',
        },
      });
    }

    if (monitor.alertEmails.length) {
      const email = uptimeAlertEmail({
        websiteName,
        url: monitor.url,
        status: next.transition === 'went_down' ? 'down' : 'up',
        error: r.error ?? (r.statusCode ? `HTTP ${r.statusCode}` : null),
        since: checkedAt,
      });
      await sendMail({ kind: 'uptime', to: monitor.alertEmails, ...email });
    }
  }

  return { stored: results.length, transitions };
}

export async function getUptimeSummary(websiteIds: string[], days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const monitors = await prisma.client.auroraMonitor.findMany({
    where: { websiteId: { in: websiteIds } },
  });

  const rows = await Promise.all(
    monitors.map(async m => {
      const where = { websiteId: m.websiteId, checkedAt: { gte: since } };
      const [total, ok, incidents] = await Promise.all([
        prisma.client.auroraUptimeCheck.count({ where }),
        prisma.client.auroraUptimeCheck.count({ where: { ...where, ok: true } }),
        prisma.client.auroraIncident.findMany({
          where: { websiteId: m.websiteId, startedAt: { gte: since } },
          orderBy: { startedAt: 'desc' },
          take: 10,
        }),
      ]);

      return {
        websiteId: m.websiteId,
        url: m.url,
        enabled: m.enabled,
        status: m.status,
        lastCheckedAt: m.lastCheckedAt,
        lastLatencyMs: m.lastLatencyMs,
        alertEmails: m.alertEmails,
        keyword: m.keyword,
        uptimePct: total ? Math.round((ok / total) * 10000) / 100 : null,
        checks: total,
        incidents,
      };
    }),
  );

  return rows;
}

export async function pruneUptimeChecks(now = new Date()) {
  const cutoff = new Date(now.getTime() - UPTIME_RETENTION_DAYS * 86400000);
  const { count } = await prisma.client.auroraUptimeCheck.deleteMany({
    where: { checkedAt: { lt: cutoff } },
  });

  return count;
}
