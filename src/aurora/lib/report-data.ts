import prisma from '@/lib/prisma';
import { getPageviewMetrics, getSessionMetrics, getWebsiteStats } from '@/queries/sql';

export interface RawStats {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

export interface MetricRow {
  x: string;
  y: number;
}

export type TopType = 'path' | 'referrer' | 'country';

/** Data access used by reports. Swappable in tests. */
export interface ReportDataSource {
  getStats(websiteId: string, startDate: Date, endDate: Date): Promise<RawStats>;
  getTop(
    websiteId: string,
    type: TopType,
    startDate: Date,
    endDate: Date,
    limit: number,
  ): Promise<MetricRow[]>;
  getUptime(
    websiteId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ total: number; ok: number; incidents: number } | null>;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export const umamiDataSource: ReportDataSource = {
  async getStats(websiteId, startDate, endDate) {
    const result: any = await getWebsiteStats(websiteId, { startDate, endDate } as any);
    // Relational queries return a single row object; normalize either shape.
    const row = Array.isArray(result) ? result[0] : result;

    return {
      pageviews: num(row?.pageviews),
      visitors: num(row?.visitors),
      visits: num(row?.visits),
      bounces: num(row?.bounces),
      totaltime: num(row?.totaltime),
    };
  },

  async getTop(websiteId, type, startDate, endDate, limit) {
    const filters = { startDate, endDate } as any;
    const params = { type, limit, offset: 0 };
    const rows: any[] =
      type === 'country'
        ? await getSessionMetrics(websiteId, params, filters)
        : await getPageviewMetrics(websiteId, params, filters);

    return (rows ?? [])
      .filter(r => r?.x !== null && r?.x !== undefined && r?.x !== '')
      .map(r => ({ x: String(r.x), y: num(r.y) }));
  },

  async getUptime(websiteId, startDate, endDate) {
    const monitor = await prisma.client.auroraMonitor.findUnique({ where: { websiteId } });

    if (!monitor) {
      return null;
    }

    const where = { websiteId, checkedAt: { gte: startDate, lte: endDate } };
    const [total, ok, incidents] = await Promise.all([
      prisma.client.auroraUptimeCheck.count({ where }),
      prisma.client.auroraUptimeCheck.count({ where: { ...where, ok: true } }),
      prisma.client.auroraIncident.count({
        where: { websiteId, startedAt: { gte: startDate, lte: endDate } },
      }),
    ]);

    return { total, ok, incidents };
  },
};
