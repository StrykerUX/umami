import { uuid } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import prisma from '@/lib/prisma';
import { resetEmail } from '../emails/templates';
import { getAppUrl, RESET_TTL_MINUTES } from './constants';
import { sendMail } from './mailer';
import { generateToken, hashToken, normalizeEmail } from './tokens';

/**
 * Starts a reset for the account matching the email (or username). Always resolves
 * the same way to the caller so accounts cannot be enumerated.
 */
export async function requestPasswordReset(identifier: string) {
  const value = identifier.trim().toLowerCase();
  let userId: string | null = null;
  let email: string | null = null;

  const profile = await prisma.client.auroraUserProfile.findUnique({
    where: { email: normalizeEmail(value) },
  });

  if (profile) {
    userId = profile.userId;
    email = profile.email;
  } else {
    const user = await prisma.client.user.findFirst({
      where: { username: value, deletedAt: null },
    });
    if (user) {
      const p = await prisma.client.auroraUserProfile.findUnique({ where: { userId: user.id } });
      userId = user.id;
      email = p?.email ?? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.username) ? user.username : null);
    }
  }

  if (!userId || !email) {
    return { sent: false };
  }

  const user = await prisma.client.user.findFirst({ where: { id: userId, deletedAt: null } });

  if (!user) {
    return { sent: false };
  }

  const token = generateToken('rst');

  await prisma.client.auroraPasswordReset.create({
    data: {
      id: uuid(),
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60000),
    },
  });

  const message = resetEmail({
    url: `${getAppUrl()}/reset/${encodeURIComponent(token)}`,
    username: user.username,
  });
  await sendMail({ kind: 'password-reset', to: [email], ...message });

  return { sent: true };
}

export async function resetPassword(token: string, password: string) {
  if (!token || token.length > 200) return false;

  const reset = await prisma.client.auroraPasswordReset.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  const claimed = await prisma.client.auroraPasswordReset.updateMany({
    where: { id: reset.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (claimed.count !== 1) {
    return false;
  }

  // Changing the hash also invalidates existing sessions (tokens are bound to it).
  await prisma.client.user.update({
    where: { id: reset.userId },
    data: { password: hashPassword(password) },
  });

  // Burn any other outstanding reset links for this user.
  await prisma.client.auroraPasswordReset.updateMany({
    where: { userId: reset.userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  return true;
}
