import { FREQUENCY_LABELS } from '../lib/periods';
import type { ReportSnapshot, TopRow } from '../lib/report';
import { BRAND, button, escapeHtml, layout } from './layout';

export function formatNumber(n: number) {
  return Math.round(n).toLocaleString('es-MX');
}

export function formatDuration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

/** Delta badge. `inverse` = lower is better (bounce rate). `points` = absolute pp change. */
export function deltaBadge(
  value: number | null,
  options: { inverse?: boolean; points?: boolean } = {},
) {
  if (value === null) {
    return `<span style="color:${BRAND.accent};font-size:12px">nuevo</span>`;
  }
  if (value === 0) {
    return `<span style="color:${BRAND.muted};font-size:12px">= 0${options.points ? ' pp' : '%'}</span>`;
  }
  const good = options.inverse ? value < 0 : value > 0;
  const arrow = value > 0 ? '▲' : '▼';
  const color = good ? BRAND.up : BRAND.down;
  const text = `${value > 0 ? '+' : ''}${value.toLocaleString('es-MX')}${options.points ? ' pp' : '%'}`;

  return `<span style="color:${color};font-size:12px;font-weight:600">${arrow} ${escapeHtml(text)}</span>`;
}

function kpiCell(label: string, value: string, badge: string) {
  return `<td style="padding:10px;border:1px solid ${BRAND.border};border-radius:8px;width:25%;vertical-align:top">
<div style="color:${BRAND.muted};font-size:12px">${escapeHtml(label)}</div>
<div style="font-size:20px;font-weight:700;margin:4px 0">${escapeHtml(value)}</div>${badge}</td>`;
}

function kpiTable(s: ReportSnapshot['totals']) {
  return `<table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>
${kpiCell('Visitantes', formatNumber(s.current.visitors), deltaBadge(s.delta.visitors))}
${kpiCell('Visitas', formatNumber(s.current.visits), deltaBadge(s.delta.visits))}
${kpiCell('Páginas vistas', formatNumber(s.current.pageviews), deltaBadge(s.delta.pageviews))}
${kpiCell('Rebote', `${s.current.bounceRate}%`, deltaBadge(s.delta.bounceRate, { inverse: true, points: true }))}
</tr></table>`;
}

function topTable(title: string, rows?: TopRow[]) {
  if (!rows?.length) return '';

  return `<p style="margin:16px 0 6px;font-weight:600">${escapeHtml(title)}</p>
<table role="presentation" width="100%" cellpadding="4" cellspacing="0" style="font-size:13px">
${rows
  .slice(0, 5)
  .map(
    r => `<tr><td style="border-bottom:1px solid ${BRAND.border};word-break:break-all">${escapeHtml(r.x)}</td>
<td align="right" style="border-bottom:1px solid ${BRAND.border};white-space:nowrap">${formatNumber(r.y)}</td>
<td align="right" style="border-bottom:1px solid ${BRAND.border};white-space:nowrap">${deltaBadge(r.delta)}</td></tr>`,
  )
  .join('')}
</table>`;
}

export function reportEmail(snapshot: ReportSnapshot, webUrl: string) {
  const freq = FREQUENCY_LABELS[snapshot.frequency];
  const subject = `Reporte ${freq.toLowerCase()} · ${snapshot.scope.name} · ${snapshot.period.label}`;
  const highlights = snapshot.highlights.length
    ? `<ul style="padding-left:18px;margin:8px 0 16px">${snapshot.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
    : '';

  const sites = snapshot.websites
    .map(
      w => `<tr><td style="padding:16px 0;border-top:1px solid ${BRAND.border}">
<div style="font-size:16px;font-weight:700">${escapeHtml(w.name)} <span style="color:${BRAND.muted};font-weight:400;font-size:13px">${escapeHtml(w.domain ?? '')}</span></div>
<div style="font-size:13px;margin-top:6px">
Visitantes <b>${formatNumber(w.current.visitors)}</b> ${deltaBadge(w.delta.visitors)} ·
Vistas <b>${formatNumber(w.current.pageviews)}</b> ${deltaBadge(w.delta.pageviews)} ·
Duración <b>${formatDuration(w.current.avgDuration)}</b> ${deltaBadge(w.delta.avgDuration)}
${w.uptime && w.uptime.pct !== null ? ` · Uptime <b>${w.uptime.pct}%</b>` : ''}
</div>
${topTable('Páginas principales', w.topPages)}
${topTable('Fuentes de tráfico', w.referrers)}
${topTable('Países', w.countries)}
</td></tr>`,
    )
    .join('');

  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(snapshot.name)}</h1>
<p style="color:${BRAND.muted};margin:0 0 16px">${escapeHtml(freq)} · ${escapeHtml(snapshot.period.label)} <br>vs ${escapeHtml(snapshot.previous.label)}</p>
${snapshot.sections.kpis ? kpiTable(snapshot.totals) : ''}
${highlights}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sites || `<tr><td style="color:${BRAND.muted}">Sin sitios en este reporte.</td></tr>`}</table>
<p style="margin:24px 0 0">${button(webUrl, 'Ver reporte completo')}</p>`,
  );

  return {
    subject,
    html,
    text: `${subject}\nVisitantes: ${snapshot.totals.current.visitors}\n${snapshot.highlights.join('\n')}\n${webUrl}`,
  };
}
