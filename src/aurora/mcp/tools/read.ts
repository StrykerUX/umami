import { McpToolError } from '@umami/mcp';
import { z } from 'zod';
import { auroraCall } from '../dispatch';
import { DAYS_DESCRIPTION, defineAuroraTool, iso } from './define';

const days = z.number().int().min(1).max(366).optional().describe(DAYS_DESCRIPTION);
const limit = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('Maximum sites to return (default 25).');

interface Stats {
  pageviews: number;
  visitors: number;
  visits: number;
  bounceRate: number;
  avgDuration: number;
}

function pct(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function combineStats(rows: Stats[]): Stats {
  const sum = (key: keyof Stats) => rows.reduce((acc, r) => acc + (r[key] || 0), 0);
  const visits = sum('visits');
  const weighted = (key: 'bounceRate' | 'avgDuration') =>
    visits ? rows.reduce((acc, r) => acc + (r[key] || 0) * (r.visits || 0), 0) / visits : 0;

  return {
    pageviews: sum('pageviews'),
    visitors: sum('visitors'),
    visits,
    bounceRate: Math.round(weighted('bounceRate') * 10) / 10,
    avgDuration: Math.round(weighted('avgDuration')),
  };
}

export function deltas(current: Stats, previous: Stats) {
  return {
    pageviews: pct(current.pageviews, previous.pageviews),
    visitors: pct(current.visitors, previous.visitors),
    visits: pct(current.visits, previous.visits),
    bounceRatePoints: Math.round((current.bounceRate - previous.bounceRate) * 10) / 10,
    avgDuration: pct(current.avgDuration, previous.avgDuration),
  };
}

function summarizeOverview(result: any, max: number) {
  const rows: any[] = result?.data ?? [];
  const current = combineStats(rows.map(r => r.current));
  const previous = combineStats(rows.map(r => r.previous));
  const sites = [...rows]
    .sort((a, b) => (b.current?.visitors ?? 0) - (a.current?.visitors ?? 0))
    .slice(0, max)
    .map(r => ({
      websiteId: r.id,
      name: r.name,
      domain: r.domain,
      workspaceId: r.workspaceId,
      clientId: r.clientId,
      current: r.current,
      deltaPct: r.delta,
      uptime: r.uptime?.status ?? null,
    }));

  return {
    days: result?.days,
    startAt: iso(result?.startAt),
    endAt: iso(result?.endAt),
    siteCount: rows.length,
    totals: { current, previous, deltaPct: deltas(current, previous) },
    sites,
    truncated: rows.length > sites.length,
  };
}

const NOTE =
  ' Aurora tools cover the organization layer (workspaces, clients, scheduled reports, uptime); ' +
  'use the Umami tools (get_website_stats, get_website_metrics, …) for deep analytics of one website.';

export const listWorkspaces = defineAuroraTool({
  name: 'aurora_list_workspaces',
  title: 'List Aurora workspaces',
  description:
    'Lists the organization workspaces (classification buckets: internal or external) with how many clients each has. ' +
    'Use the returned workspaceId to filter aurora_overview, aurora_list_clients or aurora_list_sites.' +
    NOTE,
  inputSchema: z.object({}),
  async handler(_input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/workspaces');

    return {
      workspaces: (result.data ?? []).map((w: any) => ({
        id: w.id,
        name: w.name,
        kind: w.kind,
        clientCount: w._count?.clients ?? 0,
      })),
    };
  },
});

export const listClientTypes = defineAuroraTool({
  name: 'aurora_list_client_types',
  title: 'List Aurora client types',
  description:
    'Lists client types (e.g. retainer, project) with their client counts. Use clientTypeId to filter aurora_overview.',
  inputSchema: z.object({}),
  async handler(_input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/client-types');

    return {
      clientTypes: (result.data ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        clientCount: t._count?.clients ?? 0,
      })),
    };
  },
});

export const listClients = defineAuroraTool({
  name: 'aurora_list_clients',
  title: 'List Aurora clients',
  description:
    'Lists clients (external organizations that receive reports; they do not log in) with workspace, type and number of websites. ' +
    'Optionally filter by workspaceId or clientTypeId. Use aurora_client_summary for one client in depth.',
  inputSchema: z.object({
    workspaceId: z.uuid().optional().describe('Only clients in this workspace.'),
    clientTypeId: z.uuid().optional().describe('Only clients of this type.'),
    activeOnly: z.boolean().optional().describe('Exclude inactive clients (default false).'),
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/clients', {
      query: { workspaceId: input.workspaceId, clientTypeId: input.clientTypeId },
    });
    const clients = (result.data ?? []).filter((c: any) => !input.activeOnly || c.active);

    return {
      clients: clients.map((c: any) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        workspace: c.workspace ? { id: c.workspace.id, name: c.workspace.name } : null,
        clientType: c.clientType ? { id: c.clientType.id, name: c.clientType.name } : null,
        websiteCount: c.websiteCount ?? 0,
        contactCount: c.contactEmails?.length ?? 0,
      })),
    };
  },
});

export const listSites = defineAuroraTool({
  name: 'aurora_list_sites',
  title: 'List Aurora sites',
  description:
    'Lists organization websites with their Aurora classification (workspace, client, tags) and uptime monitor status. ' +
    'Filter by workspaceId, clientId, tag or a name/domain search.',
  inputSchema: z.object({
    workspaceId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    tag: z.string().optional(),
    search: z.string().optional().describe('Case-insensitive match on name or domain.'),
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/websites');
    const search = input.search?.toLowerCase();
    const sites = (result.data ?? []).filter(
      (w: any) =>
        (!input.workspaceId || w.workspaceId === input.workspaceId) &&
        (!input.clientId || w.clientId === input.clientId) &&
        (!input.tag || w.tags?.includes(input.tag)) &&
        (!search ||
          w.name?.toLowerCase().includes(search) ||
          w.domain?.toLowerCase().includes(search)),
    );

    return {
      sites: sites.map((w: any) => ({
        websiteId: w.id,
        name: w.name,
        domain: w.domain,
        workspaceId: w.workspaceId,
        clientId: w.clientId,
        tags: w.tags ?? [],
        monitor: w.monitor ? { status: w.monitor.status, enabled: w.monitor.enabled } : null,
      })),
    };
  },
});

export const overview = defineAuroraTool({
  name: 'aurora_overview',
  title: 'Aurora overview',
  description:
    'Organization KPIs (pageviews, visitors, visits, bounce rate, avg visit seconds) for the last N days compared with the previous N days, ' +
    'aggregated and per site, optionally filtered by workspaceId, clientId or clientTypeId. ' +
    'deltaPct values are percent changes (null when the previous value was 0); bounceRatePoints is the change in percentage points.',
  inputSchema: z.object({
    days,
    workspaceId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    clientTypeId: z.uuid().optional(),
    limit,
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/overview', {
      query: {
        days: input.days ?? 30,
        workspaceId: input.workspaceId,
        clientId: input.clientId,
        clientTypeId: input.clientTypeId,
      },
    });

    return summarizeOverview(result, input.limit ?? 25);
  },
});

function compactSchedule(s: any) {
  return {
    id: s.id,
    name: s.name,
    scope: s.scope,
    scopeId: s.scopeId ?? null,
    frequency: s.frequency,
    timezone: s.timezone,
    active: s.active,
    nextRunAt: iso(s.nextRunAt),
    lastRunAt: iso(s.lastRunAt),
    recipientCount: s.recipients?.length ?? 0,
    includeClientContacts: s.includeClientContacts,
    lastRun: s.runs?.[0]
      ? {
          id: s.runs[0].id,
          status: s.runs[0].status,
          createdAt: iso(s.runs[0].createdAt),
          sentAt: iso(s.runs[0].sentAt),
        }
      : null,
  };
}

function compactIncident(websiteId: string, i: any) {
  return {
    websiteId,
    id: i.id,
    startedAt: iso(i.startedAt),
    resolvedAt: iso(i.resolvedAt),
    open: !i.resolvedAt,
    durationMinutes: i.resolvedAt
      ? Math.round((new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime()) / 60000)
      : null,
    cause: i.cause ?? null,
  };
}

function compactMonitor(site: any) {
  const m = site.monitor;

  return {
    websiteId: site.id,
    name: site.name,
    domain: site.domain,
    monitored: !!m,
    ...(m && {
      enabled: m.enabled,
      status: m.status,
      uptimePct30d: m.uptimePct,
      checks30d: m.checks,
      lastCheckedAt: iso(m.lastCheckedAt),
      lastLatencyMs: m.lastLatencyMs,
      openIncident: (m.incidents ?? []).some((i: any) => !i.resolvedAt),
    }),
  };
}

export const clientSummary = defineAuroraTool({
  name: 'aurora_client_summary',
  title: 'Aurora client summary',
  description:
    'Everything about one client: profile, its websites with KPIs vs the previous period, uptime, and the report schedules scoped to it. ' +
    'Get clientId from aurora_list_clients.',
  inputSchema: z.object({ clientId: z.uuid(), days }),
  async handler(input, context) {
    const [client, ov, uptime, reports] = await Promise.all([
      auroraCall(context, 'GET', `/api/aurora/clients/${input.clientId}`),
      auroraCall(context, 'GET', '/api/aurora/overview', {
        query: { days: input.days ?? 30, clientId: input.clientId },
      }),
      auroraCall(context, 'GET', '/api/aurora/uptime'),
      auroraCall(context, 'GET', '/api/aurora/reports'),
    ]);
    const siteIds = new Set<string>(client.websiteIds ?? []);

    return {
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        workspace: client.workspace
          ? { id: client.workspace.id, name: client.workspace.name }
          : null,
        clientType: client.clientType
          ? { id: client.clientType.id, name: client.clientType.name }
          : null,
        contactCount: client.contactEmails?.length ?? 0,
        notes: client.notes ?? null,
      },
      overview: summarizeOverview(ov, 50),
      uptime: (uptime.data ?? []).filter((s: any) => siteIds.has(s.id)).map(compactMonitor),
      reports: (reports.data ?? [])
        .filter((s: any) => s.scope === 'client' && s.scopeId === input.clientId)
        .map(compactSchedule),
    };
  },
});

export const listReports = defineAuroraTool({
  name: 'aurora_list_reports',
  title: 'List Aurora scheduled reports',
  description:
    'Lists scheduled email reports (weekly, biweekly = calendar halves, monthly, bimonthly) with scope, next run and latest run. ' +
    'Use aurora_get_report_run to read a run’s numbers and its shareable link.',
  inputSchema: z.object({
    activeOnly: z.boolean().optional(),
    scope: z.enum(['all', 'workspace', 'client', 'website']).optional(),
    scopeId: z.uuid().optional(),
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/reports');
    const rows = (result.data ?? []).filter(
      (s: any) =>
        (!input.activeOnly || s.active) &&
        (!input.scope || s.scope === input.scope) &&
        (!input.scopeId || s.scopeId === input.scopeId),
    );

    return { reports: rows.map(compactSchedule) };
  },
});

export const getReportRun = defineAuroraTool({
  name: 'aurora_get_report_run',
  title: 'Get Aurora report run',
  description:
    'Returns one report run: period, previous period, status, the KPI/top-list snapshot that was sent and a shareable web link. ' +
    'Pass runId, or reportId to get that report’s latest run.',
  inputSchema: z.object({
    runId: z.uuid().optional(),
    reportId: z.uuid().optional().describe('Latest run of this scheduled report.'),
  }),
  async handler(input, context) {
    let runId = input.runId;

    if (!runId) {
      if (!input.reportId) {
        throw new McpToolError('invalid_input', 'Pass runId or reportId.');
      }

      const runs = await auroraCall(context, 'GET', `/api/aurora/reports/${input.reportId}/runs`);
      runId = runs.data?.[0]?.id;

      if (!runId) {
        throw new McpToolError('not_found', 'That report has not run yet.');
      }
    }

    const run = await auroraCall(context, 'GET', `/api/aurora/reports/runs/${runId}`);

    return {
      id: run.id,
      reportId: run.scheduleId,
      status: run.status,
      error: run.error ?? null,
      period: { start: iso(run.periodStart), end: iso(run.periodEnd) },
      previousPeriod: { start: iso(run.prevStart), end: iso(run.prevEnd) },
      sentAt: iso(run.sentAt),
      recipientCount: run.sentTo?.length ?? 0,
      shareUrl: run.shareUrl,
      snapshot: run.snapshot,
    };
  },
});

export const uptimeStatus = defineAuroraTool({
  name: 'aurora_uptime_status',
  title: 'Aurora uptime status',
  description:
    'Uptime monitor status per organization website: up/down, 30-day uptime %, last check, latency and whether an incident is open. ' +
    'Filter by websiteId or status.',
  inputSchema: z.object({
    websiteId: z.uuid().optional(),
    status: z.enum(['up', 'down', 'unknown']).optional(),
    monitoredOnly: z.boolean().optional().describe('Skip sites without a monitor (default true).'),
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/uptime');
    const sites = (result.data ?? [])
      .filter((s: any) => !input.websiteId || s.id === input.websiteId)
      .filter((s: any) => ((input.monitoredOnly ?? true) ? !!s.monitor : true))
      .filter((s: any) => !input.status || s.monitor?.status === input.status)
      .map(compactMonitor);

    return {
      down: sites.filter((s: any) => s.status === 'down').length,
      monitored: sites.filter((s: any) => s.monitored).length,
      sites,
    };
  },
});

export const listIncidents = defineAuroraTool({
  name: 'aurora_list_incidents',
  title: 'List Aurora uptime incidents',
  description:
    'Downtime incidents of the last 30 days (most recent first), with duration. Filter by websiteId or openOnly.',
  inputSchema: z.object({
    websiteId: z.uuid().optional(),
    openOnly: z.boolean().optional(),
  }),
  async handler(input, context) {
    const result = await auroraCall(context, 'GET', '/api/aurora/uptime');
    const incidents = (result.data ?? [])
      .filter((s: any) => s.monitor && (!input.websiteId || s.id === input.websiteId))
      .flatMap((s: any) =>
        (s.monitor.incidents ?? []).map((i: any) => ({
          ...compactIncident(s.id, i),
          site: s.name,
        })),
      )
      .filter((i: any) => !input.openOnly || i.open)
      .sort((a: any, b: any) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));

    return { incidents };
  },
});

export const health = defineAuroraTool({
  name: 'aurora_health',
  title: 'Aurora health',
  description:
    'Internal health of the Aurora/Umami deployment (database, migrations, cron, uptime worker, email, reports, monitors). Admins only.',
  inputSchema: z.object({}),
  async handler(_input, context) {
    return auroraCall(context, 'GET', '/api/aurora/health/details');
  },
});

export const auroraReadTools = [
  listWorkspaces,
  listClientTypes,
  listClients,
  listSites,
  overview,
  clientSummary,
  listReports,
  getReportRun,
  uptimeStatus,
  listIncidents,
  health,
];
