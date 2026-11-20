import type { AuroraRole } from '../lib/constants';
import { BRAND, button, escapeHtml, layout } from './layout';

const ROLE_LABELS: Record<AuroraRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Solo lectura',
};

export function roleLabel(role: AuroraRole) {
  return ROLE_LABELS[role] ?? role;
}

export function inviteEmail(input: {
  url: string;
  role: AuroraRole;
  inviter?: string | null;
  expiresAt: Date;
}) {
  const subject = 'Te invitaron a Aurora Analytics';
  const expires = input.expiresAt.toLocaleDateString('es-MX', { dateStyle: 'long' });
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 12px">Tienes una invitación</h1>
<p>${input.inviter ? `<b>${escapeHtml(input.inviter)}</b> te invitó` : 'Te invitaron'} a Aurora Analytics con el rol <b>${escapeHtml(roleLabel(input.role))}</b>.</p>
<p>Crea tu cuenta para entrar:</p>
<p style="margin:24px 0">${button(input.url, 'Aceptar invitación')}</p>
<p style="color:${BRAND.muted};font-size:13px">El link vence el ${escapeHtml(expires)}. Si no esperabas este correo, ignóralo.</p>`,
  );

  return { subject, html, text: `Acepta tu invitación: ${input.url}` };
}

export function resetEmail(input: { url: string; username: string }) {
  const subject = 'Restablece tu contraseña de Aurora Analytics';
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 12px">Restablecer contraseña</h1>
<p>Recibimos una solicitud para cambiar la contraseña del usuario <b>${escapeHtml(input.username)}</b>.</p>
<p style="margin:24px 0">${button(input.url, 'Elegir nueva contraseña')}</p>
<p style="color:${BRAND.muted};font-size:13px">El link vence en 1 hora y solo se puede usar una vez. Si no lo pediste, ignora este correo.</p>`,
  );

  return { subject, html, text: `Restablece tu contraseña: ${input.url}` };
}

export function uptimeAlertEmail(input: {
  websiteName: string;
  url: string;
  status: 'down' | 'up';
  error?: string | null;
  since: Date;
}) {
  const down = input.status === 'down';
  const subject = down ? `🔴 Caído: ${input.websiteName}` : `🟢 Recuperado: ${input.websiteName}`;
  const when = input.since.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const html = layout(
    subject,
    `<h1 style="font-size:20px;margin:0 0 12px;color:${down ? BRAND.down : BRAND.up}">${escapeHtml(subject)}</h1>
<p><b>URL:</b> ${escapeHtml(input.url)}</p>
<p><b>${down ? 'Desde' : 'Recuperado'}:</b> ${escapeHtml(when)}</p>
${input.error ? `<p><b>Detalle:</b> ${escapeHtml(input.error)}</p>` : ''}`,
  );

  return { subject, html, text: `${subject} — ${input.url}` };
}
