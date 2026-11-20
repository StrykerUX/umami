import { z } from 'zod';
import { auroraRequest, json } from '@/aurora/lib/api';
import { getOrgWebsites } from '@/aurora/lib/org';
import { statDeltas, toStats } from '@/aurora/lib/report';
import { umamiDataSource } from '@/aurora/lib/report-data';
import prisma from '@/lib/prisma';

const schema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
  workspaceId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  clientTypeId: z.uuid().optional(),
});

/** Current window vs the previous window of the same length, per org website. */
export async function GET(request: Request) {
  const { ctx, query, error } = await auroraRequest<z.infer<typeof schema>>(request, schema);

  if (error) {
    return error;
  }

  const now = new Date();
  const ms = query.days * 86400000;
  const start = new Date(now.getTime() - ms);
  const prevStart = new Date(start.getTime() - ms);
  const prevEnd = new Date(start.getTime() - 1);

  const websites = await getOrgWebsites(ctx.orgId);
  const ids = websites.map(w => w.id);
  const [metas, monitors, clients] = await Promise.all([
    prisma.client.auroraWebsiteMeta.findMany({ where: { websiteId: { in: ids } } }),
    prisma.client.auroraMonitor.findMany({ where: { websiteId: { in: ids } } }),
    prisma.client.auroraClient.findMany({ select: { id: true, clientTypeId: true } }),
  ]);
  const metaMap = new Map(metas.map(m => [m.websiteId, m]));
  const monitorMap = new Map(monitors.map(m => [m.websiteId, m]));
  const clientType = new Map(clients.map(c => [c.id, c.clientTypeId]));

  const filtered = websites.filter(w => {
    const meta = metaMap.get(w.id);
    if (query.workspaceId && meta?.workspaceId !== query.workspaceId) return false;
    if (query.clientId && meta?.clientId !== query.clientId) return false;
    if (
      query.clientTypeId &&
      (!meta?.clientId || clientType.get(meta.clientId) !== query.clientTypeId)
    )
      return false;
    return true;
  });

  const data = await Promise.all(
    filtered.map(async w => {
      const [cur, prev] = await Promise.all([
        umamiDataSource.getStats(w.id, start, now),
        umamiDataSource.getStats(w.id, prevStart, prevEnd),
      ]);
      const current = toStats(cur);
      const previous = toStats(prev);
      const meta = metaMap.get(w.id);
      const monitor = monitorMap.get(w.id);

      return {
        ...w,
        workspaceId: meta?.workspaceId ?? null,
        clientId: meta?.clientId ?? null,
        tags: meta?.tags ?? [],
        current,
        previous,
        delta: statDeltas(current, previous),
        uptime: monitor ? { status: monitor.status, lastLatencyMs: monitor.lastLatencyMs } : null,
      };
    }),
  );

  return json({ days: query.days, startAt: start, endAt: now, data });
}
