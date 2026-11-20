export const BRAND = {
  name: 'Aurora Analytics',
  primary: '#6d5ef6',
  accent: '#22c7d6',
  text: '#1f2330',
  muted: '#6b7280',
  border: '#e6e8ef',
  bg: '#f5f6fa',
  up: '#16a34a',
  down: '#dc2626',
};

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function button(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a>`;
}

export function layout(title: string, body: string, footer = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:${BRAND.bg};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#fff;border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden">
<tr><td style="background:linear-gradient(90deg,${BRAND.primary},${BRAND.accent});padding:18px 24px;color:#fff;font-weight:700;font-size:18px">${BRAND.name}</td></tr>
<tr><td style="padding:24px">${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px">${footer || `Enviado por ${BRAND.name}.`}</td></tr>
</table></td></tr></table></body></html>`;
}
