import { auroraRequest, json } from '@/aurora/lib/api';
import { getOrgWebsites } from '@/aurora/lib/org';
import { getUptimeSummary } from '@/aurora/lib/uptime';

export async function GET(request: Request) {
  const { ctx, error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  const websites = await getOrgWebsites(ctx.orgId);
  const summary = await getUptimeSummary(websites.map(w => w.id));
  const map = new Map(summary.map(s => [s.websiteId, s]));

  return json({
    data: websites.map(w => ({ ...w, monitor: map.get(w.id) ?? null })),
  });
}
