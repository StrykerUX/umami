import { fromZonedTime } from 'date-fns-tz';
import { REPORT_SEND_HOUR, type ReportFrequency } from './constants';

/** Calendar date in a timezone (month is 0-based). */
export interface Wall {
  y: number;
  m: number;
  d: number;
}

export interface ReportPeriods {
  periodStart: Date;
  periodEnd: Date;
  prevStart: Date;
  prevEnd: Date;
}

export function wallOf(date: Date, timeZone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);

  return { y: get('year'), m: get('month') - 1, d: get('day') };
}

function normalize(y: number, m: number, d: number): Wall {
  const date = new Date(Date.UTC(y, m, d));

  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate() };
}

export function startOfPeriod(frequency: ReportFrequency, w: Wall): Wall {
  switch (frequency) {
    case 'weekly': {
      const dow = new Date(Date.UTC(w.y, w.m, w.d)).getUTCDay();
      return normalize(w.y, w.m, w.d - ((dow + 6) % 7));
    }
    case 'biweekly':
      return { y: w.y, m: w.m, d: w.d < 16 ? 1 : 16 };
    case 'monthly':
      return { y: w.y, m: w.m, d: 1 };
    case 'bimonthly':
      return { y: w.y, m: w.m - (w.m % 2), d: 1 };
  }
}

/** Moves a period start by n periods (n may be negative). */
export function addPeriods(frequency: ReportFrequency, start: Wall, n: number): Wall {
  switch (frequency) {
    case 'weekly':
      return normalize(start.y, start.m, start.d + 7 * n);
    case 'monthly':
      return normalize(start.y, start.m + n, 1);
    case 'bimonthly':
      return normalize(start.y, start.m + 2 * n, 1);
    case 'biweekly': {
      // Half-month index: two halves per month.
      const index = (start.y * 12 + start.m) * 2 + (start.d >= 16 ? 1 : 0) + n;
      const monthIndex = Math.floor(index / 2);
      return { y: Math.floor(monthIndex / 12), m: monthIndex % 12, d: index % 2 ? 16 : 1 };
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export function wallToInstant(w: Wall, timeZone: string, hour = 0): Date {
  return fromZonedTime(`${w.y}-${pad(w.m + 1)}-${pad(w.d)}T${pad(hour)}:00:00`, timeZone);
}

/** The last fully completed period before `now`, and the one before it. End dates are inclusive. */
export function getReportPeriods(
  frequency: ReportFrequency,
  now: Date,
  timeZone: string,
): ReportPeriods {
  const current = startOfPeriod(frequency, wallOf(now, timeZone));
  const start = addPeriods(frequency, current, -1);
  const prev = addPeriods(frequency, current, -2);

  return {
    periodStart: wallToInstant(start, timeZone),
    periodEnd: new Date(wallToInstant(current, timeZone).getTime() - 1),
    prevStart: wallToInstant(prev, timeZone),
    prevEnd: new Date(wallToInstant(start, timeZone).getTime() - 1),
  };
}

/** Next send time: the start of the next period at REPORT_SEND_HOUR local time. */
export function getNextRunAt(
  frequency: ReportFrequency,
  now: Date,
  timeZone: string,
  hour = REPORT_SEND_HOUR,
): Date {
  const current = startOfPeriod(frequency, wallOf(now, timeZone));
  const thisPeriodRun = wallToInstant(current, timeZone, hour);

  if (thisPeriodRun.getTime() > now.getTime()) {
    return thisPeriodRun;
  }

  return wallToInstant(addPeriods(frequency, current, 1), timeZone, hour);
}

export function formatPeriodLabel(start: Date, end: Date, timeZone: string, locale = 'es-MX') {
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

export const FREQUENCY_LABELS: Record<ReportFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
};
