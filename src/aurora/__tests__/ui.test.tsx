import { render, screen } from '@testing-library/react';
import { ZenProvider } from '@umami/react-zen';
import { describe, expect, test } from 'vitest';
import { deltaText, deltaTone, parseEmails } from '../components/format';
import { ReportView } from '../components/ReportView';
import { Delta } from '../components/ui';
import type { ReportSnapshot } from '../lib/report';

const stats = { pageviews: 300, visitors: 120, visits: 150, bounceRate: 40, avgDuration: 75 };

const snapshot: ReportSnapshot = {
  version: 1,
  name: 'Reporte Cliente X',
  frequency: 'biweekly',
  scope: { type: 'client', id: 'c1', name: 'Cliente X' },
  timezone: 'America/Mexico_City',
  period: { start: '', end: '', label: '1 nov 2026 – 15 nov 2026' },
  previous: { start: '', end: '', label: '16 oct 2026 – 31 oct 2026' },
  sections: { kpis: true, topPages: true, referrers: true, countries: true, uptime: true },
  totals: {
    current: stats,
    previous: { ...stats, visitors: 100 },
    delta: { pageviews: 0, visitors: 20, visits: -5, bounceRate: -2, avgDuration: null },
  },
  websites: [
    {
      id: 'w1',
      name: 'cliente-x.com',
      domain: 'cliente-x.com',
      current: stats,
      previous: stats,
      delta: { pageviews: 0, visitors: 0, visits: 0, bounceRate: 0, avgDuration: 0 },
      topPages: [{ x: '/precios', y: 80, prev: 40, delta: 100 }],
      referrers: [],
      countries: [],
      uptime: { pct: 99.9, prevPct: 100, incidents: 1 },
    },
  ],
  highlights: ['Los visitantes subieron +20% vs el periodo anterior.'],
};

const wrap = (ui: React.ReactNode) => render(<ZenProvider>{ui}</ZenProvider>);

describe('format helpers', () => {
  test('delta text and tone', () => {
    expect(deltaText(12.5)).toBe('+12.5%');
    expect(deltaText(-3, true)).toBe('-3 pp');
    expect(deltaText(null)).toBe('nuevo');
    expect(deltaTone(5)).toBe('up');
    expect(deltaTone(5, true)).toBe('down');
    expect(deltaTone(0)).toBe('neutral');
  });

  test('parseEmails splits on commas, spaces and semicolons', () => {
    expect(parseEmails('A@x.com, b@y.com;c@z.com  d@w.com')).toEqual([
      'a@x.com',
      'b@y.com',
      'c@z.com',
      'd@w.com',
    ]);
  });
});

describe('components', () => {
  test('Delta shows tone for inverse metrics', () => {
    wrap(<Delta value={-2} inverse points />);
    const el = screen.getByTestId('delta');
    expect(el.dataset.tone).toBe('up');
    expect(el.textContent).toContain('-2 pp');
  });

  test('ReportView renders KPIs, highlights and per-site sections', () => {
    wrap(<ReportView snapshot={snapshot} />);
    expect(screen.getByText('Reporte Cliente X')).toBeInTheDocument();
    expect(screen.getByText(/Quincenal/)).toBeInTheDocument();
    expect(screen.getByText(/Comparado con 16 oct 2026/)).toBeInTheDocument();
    expect(
      screen.getByText('Los visitantes subieron +20% vs el periodo anterior.'),
    ).toBeInTheDocument();
    expect(screen.getByText('/precios')).toBeInTheDocument();
    expect(screen.getByText(/Uptime/)).toBeInTheDocument();
  });
});
