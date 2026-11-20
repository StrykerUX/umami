import debug from 'debug';
import { uuid } from '@/lib/crypto';
import prisma from '@/lib/prisma';

const log = debug('umami:aurora:mail');

export interface MailMessage {
  kind: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface MailResult {
  id: string;
  status: 'sent' | 'outbox' | 'failed';
  providerId?: string;
  error?: string;
}

/**
 * Driver selection:
 * - `resend` when RESEND_API_KEY is set (production)
 * - `outbox` otherwise: the message is stored in aurora_email_log only (dev/tests)
 */
export function getMailDriver(): 'resend' | 'outbox' {
  if (process.env.AURORA_MAIL_DRIVER === 'outbox') return 'outbox';
  return process.env.RESEND_API_KEY ? 'resend' : 'outbox';
}

export function getMailFrom() {
  return process.env.MAIL_FROM || 'Aurora Analytics <analytics@aurora33.org>';
}

async function sendWithResend(message: MailMessage) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: getMailFrom(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
    }),
  });

  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || `Resend responded ${res.status}`);
  }

  return data?.id as string | undefined;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const to = Array.from(new Set(message.to.map(e => e.trim()).filter(Boolean)));
  const id = uuid();
  const driver = getMailDriver();
  let result: MailResult;

  if (!to.length) {
    return { id, status: 'failed', error: 'No recipients.' };
  }

  if (driver === 'outbox') {
    result = { id, status: 'outbox' };
  } else {
    try {
      const providerId = await sendWithResend({ ...message, to });
      result = { id, status: 'sent', providerId };
    } catch (e: any) {
      result = { id, status: 'failed', error: String(e?.message ?? e).slice(0, 1000) };
    }
  }

  log('%s %s -> %s (%s)', message.kind, message.subject, to.join(','), result.status);

  await prisma.client.auroraEmailLog.create({
    data: {
      id,
      kind: message.kind,
      to,
      subject: message.subject.slice(0, 300),
      status: result.status,
      providerId: result.providerId,
      error: result.error,
      // Keep the body only when it was not delivered (outbox/debugging).
      html: result.status === 'sent' ? null : message.html,
    },
  });

  return result;
}
