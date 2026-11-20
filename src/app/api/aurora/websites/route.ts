import { auroraRequest, json } from '@/aurora/lib/api';
import { getOrgWebsites } from '@/aurora/lib/org';
import prisma from '@/lib/prisma';

/** Organization websites with their Aurora classification and monitor status. */
export async function GET(request: Request) {
  const { ctx, error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const websites = await getOrgWebsites(ctx.orgId);
  const ids = websites.map(w => w.id);
  const [metas, monitors] = await Promise.all([
    prisma.client.auroraWebsiteMeta.findMany({ where: { websiteId: { in: ids } } }),
    prisma.client.auroraMonitor.findMany({ where: { websiteId: { in: ids } } }),
  ]);
  const metaMap = new Map(metas.map(m => [m.websiteId, m]));
  const monitorMap = new Map(monitors.map(m => [m.websiteId, m]));

  return json({
    data: websites.map(w => ({
      ...w,
      workspaceId: metaMap.get(w.id)?.workspaceId ?? null,
      clientId: metaMap.get(w.id)?.clientId ?? null,
      tags: metaMap.get(w.id)?.tags ?? [],
      monitor: (m =>
        m ? { status: m.status, enabled: m.enabled, lastLatencyMs: m.lastLatencyMs } : null)(
        monitorMap.get(w.id),
      ),
    })),
  });
}
