import { secret, uuid } from '@/lib/crypto';
import { createSecureToken, parseSecureToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import { reportEmail } from '../emails/report';
import {
  DEFAULT_REPORT_SECTIONS,
  getAppUrl,
  REPORT_LINK_TTL_DAYS,
  type ReportFrequency,
  type ReportScope,
  type ReportSections,
} from './constants';
import { sendMail } from './mailer';
import { getOrgWebsites } from './org';
import { formatPeriodLabel, getNextRunAt, getReportPeriods, type ReportPeriods } from './periods';
import {
  type MetricRow,
  type RawStats,
  type ReportDataSource,
  umamiDataSource,
} from './report-data';

export interface Stats {
  pageviews: number;
  visitors: number;
  visits: number;
  bounceRate: number;
  avgDuration: number;
}

export type Deltas = Record<keyof Stats, number | null>;

export interface TopRow {
  x: string;
  y: number;
  prev: number;
  delta: number | null;
}

export interface WebsiteReport {
  id: string;
  name: string;
  domain: string | null;
  current: Stats;
  previous: Stats;
  delta: Deltas;
  topPages?: TopRow[];
  referrers?: TopRow[];
  countries?: TopRow[];
  uptime?: { pct: number | null; prevPct: number | null; incidents: number } | null;
}

export interface ReportSnapshot {
  version: 1;
  name: string;
  frequency: ReportFrequency;
  scope: { type: ReportScope; id: string | null; name: string };
  timezone: string;
  period: { start: string; end: string; label: string };
  previous: { start: string; end: string; label: string };
  sections: ReportSections;
  totals: { current: Stats; previous: Stats; delta: Deltas };
  websites: WebsiteReport[];
  highlights: string[];
}

export function toStats(raw: RawStats): Stats {
  const visits = raw.visits || 0;

  return {
    pageviews: raw.pageviews,
    visitors: raw.visitors,
    visits,
    bounceRate: visits ? Math.round((Math.min(raw.bounces, visits) / visits) * 1000) / 10 : 0,
    avgDuration: visits ? Math.round(raw.totaltime / visits) : 0,
  };
}

/** Percent change. null when the previous value was 0 and the current one is not. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) {
    return current ? null : 0;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function statDeltas(current: Stats, previous: Stats): Deltas {
  return {
    pageviews: pctChange(current.pageviews, previous.pageviews),
    visitors: pctChange(current.visitors, previous.visitors),
    visits: pctChange(current.visits, previous.visits),
    bounceRate: Math.round((current.bounceRate - previous.bounceRate) * 10) / 10,
    avgDuration: pctChange(current.avgDuration, previous.avgDuration),
  };
}

export function sumRaw(rows: RawStats[]): RawStats {
  return rows.reduce(
    (acc, r) => ({
      pageviews: acc.pageviews + r.pageviews,
      visitors: acc.visitors + r.visitors,
      visits: acc.visits + r.visits,
      bounces: acc.bounces + r.bounces,
      totaltime: acc.totaltime + r.totaltime,
    }),
    { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 },
  );
}

export function compareTop(current: MetricRow[], previous: MetricRow[], limit = 10): TopRow[] {
  const prev = new Map(previous.map(r => [r.x, r.y]));

  return current.slice(0, limit).map(r => {
    const p = prev.get(r.x) ?? 0;
    return { x: r.x, y: r.y, prev: p, delta: pctChange(r.y, p) };
  });
}

const fmtPct = (v: number | null) =>
  v === null ? 'nuevo' : `${v > 0 ? '+' : ''}${v.toLocaleString('es-MX')}%`;

/** Rule-based highlights: overall direction, biggest site movers, new top pages, uptime issues. */
export function buildHighlights(snapshot: Pick<ReportSnapshot, 'totals' | 'websites'>): string[] {
  const out: string[] = [];
  const { delta, current } = snapshot.totals;

  if (delta.visitors !== null && current.visitors > 0) {
    out.push(
      delta.visitors >= 0
        ? `Los visitantes subieron ${fmtPct(delta.visitors)} vs el periodo anterior.`
        : `Los visitantes bajaron ${fmtPct(delta.visitors)} vs el periodo anterior.`,
    );
  }

  const movers = snapshot.websites
    .filter(
      w => w.delta.visitors !== null && (w.current.visitors >= 20 || w.previous.visitors >= 20),
    )
    .sort((a, b) => Math.abs(b.delta.visitors ?? 0) - Math.abs(a.delta.visitors ?? 0))
    .slice(0, 2);

  for (const w of movers) {
    if (Math.abs(w.delta.visitors ?? 0) >= 15) {
      out.push(`${w.name}: visitantes ${fmtPct(w.delta.visitors)}.`);
    }
  }

  for (const w of snapshot.websites) {
    const fresh = w.topPages?.find(p => p.prev === 0 && p.y >= 10);
    if (fresh) {
      out.push(`${w.name}: nueva página destacada ${fresh.x} (${fresh.y} vistas).`);
    }
    if (w.uptime?.incidents) {
      out.push(`${w.name}: ${w.uptime.incidents} incidente(s) de disponibilidad.`);
    }
  }

  return out.slice(0, 6);
}

export interface ScopeResolution {
  name: string;
  websites: { id: string; name: string; domain: string | null }[];
  contacts: string[];
}

export async function resolveScope(
  scope: ReportScope,
  scopeId: string | null,
): Promise<ScopeResolution> {
  const all = await getOrgWebsites();

  if (scope === 'all') {
    return { name: 'Todos los sitios', websites: all, contacts: [] };
  }

  if (scope === 'website') {
    const website = all.find(w => w.id === scopeId);
    const meta = website
      ? await prisma.client.auroraWebsiteMeta.findUnique({ where: { websiteId: website.id } })
      : null;
    const client = meta?.clientId
      ? await prisma.client.auroraClient.findUnique({ where: { id: meta.clientId } })
      : null;

    return {
      name: website?.name ?? 'Sitio',
      websites: website ? [website] : [],
      contacts: client?.active ? client.contactEmails : [],
    };
  }

  const metas = await prisma.client.auroraWebsiteMeta.findMany({
    where: scope === 'client' ? { clientId: scopeId } : { workspaceId: scopeId },
  });
  const ids = new Set(metas.map(m => m.websiteId));
  const websites = all.filter(w => ids.has(w.id));

  if (scope === 'client') {
    const client = scopeId
      ? await prisma.client.auroraClient.findUnique({ where: { id: scopeId } })
      : null;

    return {
      name: client?.name ?? 'Cliente',
      websites,
      contacts: client?.active ? client.contactEmails : [],
    };
  }

  const workspace = scopeId
    ? await prisma.client.auroraWorkspace.findUnique({ where: { id: scopeId } })
    : null;

  return { name: workspace?.name ?? 'Workspace', websites, contacts: [] };
}

export async function buildSnapshot(
  input: {
    name: string;
    frequency: ReportFrequency;
    scope: ReportScope;
    scopeName: string;
    scopeId: string | null;
    timezone: string;
    sections: Partial<ReportSections>;
    websites: { id: string; name: string; domain: string | null }[];
    periods: ReportPeriods;
  },
  source: ReportDataSource = umamiDataSource,
): Promise<ReportSnapshot> {
  const sections = { ...DEFAULT_REPORT_SECTIONS, ...input.sections };
  const { periodStart, periodEnd, prevStart, prevEnd } = input.periods;
  const rawCurrent: RawStats[] = [];
  const rawPrevious: RawStats[] = [];
  const websites: WebsiteReport[] = [];

  for (const site of input.websites) {
    const [cur, prev] = await Promise.all([
      source.getStats(site.id, periodStart, periodEnd),
      source.getStats(site.id, prevStart, prevEnd),
    ]);
    rawCurrent.push(cur);
    rawPrevious.push(prev);

    const current = toStats(cur);
    const previous = toStats(prev);
    const report: WebsiteReport = {
      ...site,
      current,
      previous,
      delta: statDeltas(current, previous),
    };

    const top = async (type: 'path' | 'referrer' | 'country') => {
      const [c, p] = await Promise.all([
        source.getTop(site.id, type, periodStart, periodEnd, 10),
        source.getTop(site.id, type, prevStart, prevEnd, 100),
      ]);
      return compareTop(c, p);
    };

    if (sections.topPages) report.topPages = await top('path');
    if (sections.referrers) report.referrers = await top('referrer');
    if (sections.countries) report.countries = await top('country');

    if (sections.uptime) {
      const [u, pu] = await Promise.all([
        source.getUptime(site.id, periodStart, periodEnd),
        source.getUptime(site.id, prevStart, prevEnd),
      ]);
      const pct = (x: { total: number; ok: number } | null) =>
        x?.total ? Math.round((x.ok / x.total) * 10000) / 100 : null;
      report.uptime = u ? { pct: pct(u), prevPct: pct(pu), incidents: u.incidents } : null;
    }

    websites.push(report);
  }

  const totalsCurrent = toStats(sumRaw(rawCurrent));
  const totalsPrevious = toStats(sumRaw(rawPrevious));
  const snapshot: ReportSnapshot = {
    version: 1,
    name: input.name,
    frequency: input.frequency,
    scope: { type: input.scope, id: input.scopeId, name: input.scopeName },
    timezone: input.timezone,
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: formatPeriodLabel(periodStart, periodEnd, input.timezone),
    },
    previous: {
      start: prevStart.toISOString(),
      end: prevEnd.toISOString(),
      label: formatPeriodLabel(prevStart, prevEnd, input.timezone),
    },
    sections,
    totals: {
      current: totalsCurrent,
      previous: totalsPrevious,
      delta: statDeltas(totalsCurrent, totalsPrevious),
    },
    websites: websites.sort((a, b) => b.current.visitors - a.current.visitors),
    highlights: [],
  };

  snapshot.highlights = buildHighlights(snapshot);

  return snapshot;
}

export function createReportLinkToken(runId: string) {
  return createSecureToken({ runId, typ: 'aurora-report' }, secret(), {
    expiresIn: `${REPORT_LINK_TTL_DAYS}d`,
  });
}

export function parseReportLinkToken(token: string): string | null {
  const payload: any = parseSecureToken(token, secret());

  return payload?.typ === 'aurora-report' && payload?.runId ? payload.runId : null;
}

export function getReportUrl(runId: string) {
  return `${getAppUrl()}/r/${encodeURIComponent(createReportLinkToken(runId))}`;
}

type ScheduleRow = Awaited<ReturnType<typeof prisma.client.auroraReportSchedule.findUnique>> & {};

/**
 * Builds a run for the last completed period, stores it, and (optionally) emails it.
 * `advance` moves the schedule to its next run (cron); manual runs leave it alone.
 */
export async function runSchedule(
  schedule: NonNullable<ScheduleRow>,
  options: { now?: Date; send?: boolean; advance?: boolean; source?: ReportDataSource } = {},
) {
  const now = options.now ?? new Date();
  const frequency = schedule.frequency as ReportFrequency;
  const periods = getReportPeriods(frequency, now, schedule.timezone);
  const scope = await resolveScope(schedule.scope as ReportScope, schedule.scopeId);
  const runId = uuid();
  const recipients = Array.from(
    new Set([
      ...(schedule.recipients ?? []),
      ...(schedule.includeClientContacts ? scope.contacts : []),
    ]),
  );

  let snapshot: ReportSnapshot | null = null;
  let status = 'ok';
  let error: string | undefined;
  let sentTo: string[] = [];

  try {
    snapshot = await buildSnapshot(
      {
        name: schedule.name,
        frequency,
        scope: schedule.scope as ReportScope,
        scopeId: schedule.scopeId,
        scopeName: scope.name,
        timezone: schedule.timezone,
        sections: (schedule.sections ?? {}) as Partial<ReportSections>,
        websites: scope.websites,
        periods,
      },
      options.source,
    );
  } catch (e: any) {
    status = 'error';
    error = String(e?.message ?? e).slice(0, 2000);
  }

  await prisma.client.auroraReportRun.create({
    data: {
      id: runId,
      scheduleId: schedule.id,
      ...periods,
      snapshot: (snapshot ?? {}) as any,
      status,
      error,
    },
  });

  if (snapshot && options.send !== false && recipients.length) {
    const email = reportEmail(snapshot, getReportUrl(runId));
    const result = await sendMail({ kind: 'report', to: recipients, ...email });

    if (result.status === 'failed') {
      status = 'send_failed';
      error = result.error;
    } else {
      sentTo = recipients;
    }

    await prisma.client.auroraReportRun.update({
      where: { id: runId },
      data: { status, error, sentTo, sentAt: sentTo.length ? new Date() : null },
    });
  }

  if (options.advance) {
    await prisma.client.auroraReportSchedule.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        nextRunAt: getNextRunAt(frequency, new Date(now.getTime() + 1000), schedule.timezone),
      },
    });
  }

  return { runId, status, error, sentTo, snapshot };
}

export async function runDueSchedules(now = new Date()) {
  const due = await prisma.client.auroraReportSchedule.findMany({
    where: { active: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: 50,
  });

  const results = [];

  for (const schedule of due) {
    results.push({
      scheduleId: schedule.id,
      ...(await runSchedule(schedule, { now, advance: true })),
    });
  }

  return results.map(({ snapshot: _s, ...rest }) => rest);
}
