import { expect, test, vi } from 'vitest';

const getWebsiteStats = vi.fn();
const getPageviewMetrics = vi.fn();
const getSessionMetrics = vi.fn();

vi.mock('@/lib/prisma', () => ({ default: { client: {} } }));
vi.mock('@/queries/sql', () => ({
  getWebsiteStats: (...a: any[]) => getWebsiteStats(...a),
  getPageviewMetrics: (...a: any[]) => getPageviewMetrics(...a),
  getSessionMetrics: (...a: any[]) => getSessionMetrics(...a),
}));

import { umamiDataSource } from '../lib/report-data';

const start = new Date('2026-11-01T00:00:00Z');
const end = new Date('2026-11-15T00:00:00Z');

test('getStats accepts the single-row object returned by relational queries (bigints as strings)', async () => {
  getWebsiteStats.mockResolvedValueOnce({
    pageviews: '12',
    visitors: 3n,
    visits: 4,
    bounces: 1,
    totaltime: '90',
  });
  expect(await umamiDataSource.getStats('w', start, end)).toEqual({
    pageviews: 12,
    visitors: 3,
    visits: 4,
    bounces: 1,
    totaltime: 90,
  });
});

test('getStats also accepts an array and empty results', async () => {
  getWebsiteStats.mockResolvedValueOnce([
    { pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 0 },
  ]);
  expect((await umamiDataSource.getStats('w', start, end)).pageviews).toBe(1);
  getWebsiteStats.mockResolvedValueOnce(undefined);
  expect((await umamiDataSource.getStats('w', start, end)).visitors).toBe(0);
});

test('getTop routes countries to session metrics and drops empty keys', async () => {
  getSessionMetrics.mockResolvedValueOnce([
    { x: 'MX', y: 5 },
    { x: null, y: 2 },
  ]);
  getPageviewMetrics.mockResolvedValueOnce([{ x: '/a', y: '7' }]);

  expect(await umamiDataSource.getTop('w', 'country', start, end, 10)).toEqual([{ x: 'MX', y: 5 }]);
  expect(await umamiDataSource.getTop('w', 'path', start, end, 10)).toEqual([{ x: '/a', y: 7 }]);
  expect(getSessionMetrics.mock.calls[0][1]).toEqual({ type: 'country', limit: 10, offset: 0 });
});
