import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));
vi.mock('@/queries/sql', () => ({}));

import { reportEmail } from '../emails/report';
import {
  buildHighlights,
  buildSnapshot,
  compareTop,
  pctChange,
  statDeltas,
  sumRaw,
  toStats,
} from '../lib/report';
import type { ReportDataSource } from '../lib/report-data';

describe('stats math', () => {
  test('pctChange handles zero baselines', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(10, 0)).toBeNull();
  });

  test('toStats derives bounce rate and avg duration', () => {
    expect(toStats({ pageviews: 30, visitors: 8, visits: 10, bounces: 4, totaltime: 600 })).toEqual(
      {
        pageviews: 30,
        visitors: 8,
        visits: 10,
        bounceRate: 40,
        avgDuration: 60,
      },
    );
    expect(
      toStats({ pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 }).bounceRate,
    ).toBe(0);
  });

  test('bounce delta is in percentage points', () => {
    const cur = toStats({ pageviews: 1, visitors: 1, visits: 10, bounces: 3, totaltime: 0 });
    const prev = toStats({ pageviews: 1, visitors: 1, visits: 10, bounces: 5, totaltime: 0 });
    expect(statDeltas(cur, prev).bounceRate).toBe(-20);
  });

  test('sumRaw adds every field', () => {
    const r = { pageviews: 1, visitors: 2, visits: 3, bounces: 4, totaltime: 5 };
    expect(sumRaw([r, r])).toEqual({
      pageviews: 2,
      visitors: 4,
      visits: 6,
      bounces: 8,
      totaltime: 10,
    });
  });

  test('compareTop joins previous values', () => {
    expect(
      compareTop(
        [
          { x: '/a', y: 20 },
          { x: '/b', y: 5 },
        ],
        [{ x: '/a', y: 10 }],
      ),
    ).toEqual([
      { x: '/a', y: 20, prev: 10, delta: 100 },
      { x: '/b', y: 5, prev: 0, delta: null },
    ]);
  });
});

const source: ReportDataSource = {
  async getStats(websiteId, start) {
    const current = start.getUTCMonth() === 10;
    const base = websiteId === 'w1' ? 100 : 40;
    const visitors = current ? base * 2 : base;
    return {
      pageviews: visitors * 3,
      visitors,
      visits: visitors,
      bounces: visitors / 2,
      totaltime: visitors * 30,
    };
  },
  async getTop(_id, type, start) {
    const current = start.getUTCMonth() === 10;
    if (type === 'path')
      return current
        ? [
            { x: '/new', y: 50 },
            { x: '/', y: 30 },
          ]
        : [{ x: '/', y: 30 }];
    return [];
  },
  async getUptime(websiteId) {
    return websiteId === 'w1' ? { total: 100, ok: 99, incidents: 1 } : null;
  },
};

describe('buildSnapshot', () => {
  const periods = {
    periodStart: new Date('2026-11-01T06:00:00Z'),
    periodEnd: new Date('2026-11-16T05:59:59.999Z'),
    prevStart: new Date('2026-10-16T06:00:00Z'),
    prevEnd: new Date('2026-11-01T05:59:59.999Z'),
  };

  test('aggregates totals, compares periods, sorts sites and adds highlights', async () => {
    const snapshot = await buildSnapshot(
      {
        name: 'Clientes quincenal',
        frequency: 'biweekly',
        scope: 'all',
        scopeId: null,
        scopeName: 'Todos',
        timezone: 'America/Mexico_City',
        sections: { countries: false },
        websites: [
          { id: 'w2', name: 'Small', domain: 'small.com' },
          { id: 'w1', name: 'Big', domain: 'big.com' },
        ],
        periods,
      },
      source,
    );

    expect(snapshot.totals.current.visitors).toBe(280);
    expect(snapshot.totals.previous.visitors).toBe(140);
    expect(snapshot.totals.delta.visitors).toBe(100);
    expect(snapshot.websites.map(w => w.id)).toEqual(['w1', 'w2']);
    expect(snapshot.websites[0].topPages?.[0]).toEqual({ x: '/new', y: 50, prev: 0, delta: null });
    expect(snapshot.websites[0].countries).toBeUndefined();
    expect(snapshot.websites[0].uptime).toEqual({ pct: 99, prevPct: 99, incidents: 1 });
    expect(snapshot.websites[1].uptime).toBeNull();
    expect(snapshot.period.label).toMatch(/2026/);
    expect(snapshot.highlights.join(' ')).toContain('subieron');
    expect(snapshot.highlights.join(' ')).toContain('/new');
    expect(snapshot.highlights.join(' ')).toContain('incidente');

    const email = reportEmail(snapshot, 'https://analytics.aurora33.dev/r/tok');
    expect(email.subject).toContain('Reporte quincenal');
    expect(email.html).toContain('Big');
    expect(email.html).toContain('https://analytics.aurora33.dev/r/tok');
    expect(email.html).toContain('▲');
  });

  test('email escapes untrusted values', async () => {
    const snapshot = await buildSnapshot(
      {
        name: '<script>x</script>',
        frequency: 'weekly',
        scope: 'all',
        scopeId: null,
        scopeName: 'All',
        timezone: 'UTC',
        sections: {},
        websites: [{ id: 'w1', name: '<b>evil</b>', domain: null }],
        periods,
      },
      source,
    );
    const { html } = reportEmail(snapshot, 'https://x/r/"><img>');
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>evil</b>');
    expect(html).not.toContain('"><img>');
  });

  test('buildHighlights reports drops', () => {
    const stats = toStats({ pageviews: 10, visitors: 10, visits: 10, bounces: 0, totaltime: 0 });
    const prev = toStats({ pageviews: 20, visitors: 20, visits: 20, bounces: 0, totaltime: 0 });
    const h = buildHighlights({
      totals: { current: stats, previous: prev, delta: statDeltas(stats, prev) },
      websites: [],
    });
    expect(h[0]).toContain('bajaron');
  });
});
