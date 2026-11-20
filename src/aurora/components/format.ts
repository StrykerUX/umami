export function formatNumber(n: number | null | undefined) {
  return Math.round(n ?? 0).toLocaleString('es-MX');
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-MX', {
    dateStyle: 'medium',
    ...(withTime && { timeStyle: 'short' }),
  });
}

export function deltaText(value: number | null, points = false) {
  if (value === null) return 'nuevo';
  if (value === 0) return points ? '= 0 pp' : '= 0%';
  return `${value > 0 ? '+' : ''}${value.toLocaleString('es-MX')}${points ? ' pp' : '%'}`;
}

export function deltaTone(
  value: number | null,
  inverse = false,
): 'up' | 'down' | 'neutral' | 'new' {
  if (value === null) return 'new';
  if (value === 0) return 'neutral';
  return (inverse ? value < 0 : value > 0) ? 'up' : 'down';
}

export const ROLE_LABELS = { admin: 'Admin', editor: 'Editor', viewer: 'Solo lectura' } as const;

export const FREQUENCY_LABELS = {
  weekly: 'Semanal',
  biweekly: 'Quincenal (1–15 / 16–fin)',
  monthly: 'Mensual',
  bimonthly: 'Bimestral',
} as const;

export const SCOPE_LABELS = {
  all: 'Todos los sitios',
  workspace: 'Workspace',
  client: 'Cliente',
  website: 'Sitio',
} as const;

export function parseEmails(value: string) {
  return value
    .split(/[\s,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
