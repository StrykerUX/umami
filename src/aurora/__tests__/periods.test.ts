import { describe, expect, test } from 'vitest';
import { addPeriods, getNextRunAt, getReportPeriods, startOfPeriod, wallOf } from '../lib/periods';

const TZ = 'America/Mexico_City'; // UTC-6, no DST since 2022

describe('wallOf', () => {
  test('returns the calendar date in the target timezone', () => {
    // 2026-03-01 03:00 UTC is still Feb 28 in Mexico City
    expect(wallOf(new Date('2026-03-01T03:00:00Z'), TZ)).toEqual({ y: 2026, m: 1, d: 28 });
  });
});

describe('startOfPeriod', () => {
  test('weekly starts on Monday', () => {
    expect(startOfPeriod('weekly', { y: 2026, m: 10, d: 20 })).toEqual({ y: 2026, m: 10, d: 16 }); // Fri -> Mon
    expect(startOfPeriod('weekly', { y: 2026, m: 10, d: 16 })).toEqual({ y: 2026, m: 10, d: 16 });
    expect(startOfPeriod('weekly', { y: 2026, m: 10, d: 22 })).toEqual({ y: 2026, m: 10, d: 16 }); // Sun
  });

  test('biweekly uses calendar halves 1-15 and 16-end', () => {
    expect(startOfPeriod('biweekly', { y: 2026, m: 1, d: 15 })).toEqual({ y: 2026, m: 1, d: 1 });
    expect(startOfPeriod('biweekly', { y: 2026, m: 1, d: 16 })).toEqual({ y: 2026, m: 1, d: 16 });
    expect(startOfPeriod('biweekly', { y: 2026, m: 1, d: 28 })).toEqual({ y: 2026, m: 1, d: 16 });
  });

  test('bimonthly pairs Jan-Feb, Mar-Apr, ...', () => {
    expect(startOfPeriod('bimonthly', { y: 2026, m: 1, d: 10 })).toEqual({ y: 2026, m: 0, d: 1 });
    expect(startOfPeriod('bimonthly', { y: 2026, m: 10, d: 30 })).toEqual({ y: 2026, m: 10, d: 1 });
    expect(startOfPeriod('bimonthly', { y: 2026, m: 11, d: 31 })).toEqual({ y: 2026, m: 10, d: 1 });
  });
});

describe('addPeriods', () => {
  test('biweekly crosses month and year boundaries both ways', () => {
    expect(addPeriods('biweekly', { y: 2026, m: 11, d: 16 }, 1)).toEqual({ y: 2027, m: 0, d: 1 });
    expect(addPeriods('biweekly', { y: 2026, m: 0, d: 1 }, -1)).toEqual({ y: 2025, m: 11, d: 16 });
    expect(addPeriods('biweekly', { y: 2026, m: 0, d: 1 }, -2)).toEqual({ y: 2025, m: 11, d: 1 });
  });

  test('weekly, monthly, bimonthly', () => {
    expect(addPeriods('weekly', { y: 2026, m: 0, d: 5 }, -1)).toEqual({ y: 2025, m: 11, d: 29 });
    expect(addPeriods('monthly', { y: 2026, m: 0, d: 1 }, -1)).toEqual({ y: 2025, m: 11, d: 1 });
    expect(addPeriods('bimonthly', { y: 2026, m: 0, d: 1 }, -1)).toEqual({ y: 2025, m: 10, d: 1 });
  });
});

describe('getReportPeriods', () => {
  test('weekly: last full Mon-Sun week and the one before, in local time', () => {
    const p = getReportPeriods('weekly', new Date('2026-11-23T14:00:00Z'), TZ); // Mon 08:00 local
    expect(p.periodStart.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-11-23T05:59:59.999Z');
    expect(p.prevStart.toISOString()).toBe('2026-11-09T06:00:00.000Z');
    expect(p.prevEnd.toISOString()).toBe('2026-11-16T05:59:59.999Z');
  });

  test('biweekly on the 16th reports 1-15 vs previous month 16-end', () => {
    const p = getReportPeriods('biweekly', new Date('2026-03-16T14:00:00Z'), TZ);
    expect(p.periodStart.toISOString()).toBe('2026-03-01T06:00:00.000Z');
    expect(p.periodEnd.toISOString()).toBe('2026-03-16T05:59:59.999Z');
    expect(p.prevStart.toISOString()).toBe('2026-02-16T06:00:00.000Z');
    expect(p.prevEnd.toISOString()).toBe('2026-03-01T05:59:59.999Z');
  });

  test('biweekly on the 1st reports 16-end vs 1-15 of the same month', () => {
    const p = getReportPeriods('biweekly', new Date('2026-03-01T14:00:00Z'), TZ);
    expect(p.periodStart.toISOString()).toBe('2026-02-16T06:00:00.000Z');
    expect(p.prevStart.toISOString()).toBe('2026-02-01T06:00:00.000Z');
  });

  test('monthly and bimonthly', () => {
    const m = getReportPeriods('monthly', new Date('2026-01-01T14:00:00Z'), TZ);
    expect(m.periodStart.toISOString()).toBe('2025-12-01T06:00:00.000Z');
    expect(m.prevStart.toISOString()).toBe('2025-11-01T06:00:00.000Z');

    const b = getReportPeriods('bimonthly', new Date('2026-03-01T14:00:00Z'), TZ);
    expect(b.periodStart.toISOString()).toBe('2026-01-01T06:00:00.000Z');
    expect(b.periodEnd.toISOString()).toBe('2026-03-01T05:59:59.999Z');
    expect(b.prevStart.toISOString()).toBe('2025-11-01T06:00:00.000Z');
  });

  test('periods are contiguous and never overlap', () => {
    for (const f of ['weekly', 'biweekly', 'monthly', 'bimonthly'] as const) {
      const p = getReportPeriods(f, new Date('2026-07-19T10:00:00Z'), TZ);
      expect(p.prevEnd.getTime() + 1).toBe(p.periodStart.getTime());
      expect(p.periodEnd.getTime()).toBeLessThan(new Date('2026-07-19T10:00:00Z').getTime());
    }
  });
});

describe('getNextRunAt', () => {
  test('runs at 08:00 local on the first day of the next period', () => {
    expect(getNextRunAt('weekly', new Date('2026-11-20T18:00:00Z'), TZ).toISOString()).toBe(
      '2026-11-23T14:00:00.000Z',
    );
    expect(getNextRunAt('biweekly', new Date('2026-11-20T18:00:00Z'), TZ).toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
    expect(getNextRunAt('biweekly', new Date('2026-11-03T18:00:00Z'), TZ).toISOString()).toBe(
      '2026-11-16T14:00:00.000Z',
    );
    expect(getNextRunAt('bimonthly', new Date('2026-11-20T18:00:00Z'), TZ).toISOString()).toBe(
      '2027-01-01T14:00:00.000Z',
    );
  });

  test('same day before 08:00 runs today', () => {
    expect(getNextRunAt('monthly', new Date('2026-12-01T10:00:00Z'), TZ).toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });

  test('always strictly in the future', () => {
    const now = new Date('2026-12-01T14:00:00Z');
    expect(getNextRunAt('monthly', now, TZ).getTime()).toBeGreaterThan(now.getTime());
  });
});
