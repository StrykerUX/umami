import { uuid } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import prisma from '@/lib/prisma';
import { inviteEmail } from '../emails/templates';
import { AURORA_ROLE_MAP, type AuroraRole, getAppUrl, INVITE_DEFAULT_TTL_DAYS } from './constants';
import { sendMail } from './mailer';
import { getOrgId } from './org';
import { generateToken, hashToken, normalizeEmail } from './tokens';

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export function inviteStatus(
  invite: { revokedAt: Date | null; expiresAt: Date; uses: number; maxUses: number },
  now = new Date(),
): InviteStatus {
  if (invite.revokedAt) return 'revoked';
  if (invite.uses >= invite.maxUses) return 'accepted';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

export function inviteUrl(token: string) {
  return `${getAppUrl()}/invite/${encodeURIComponent(token)}`;
}

export async function createInvite(input: {
  kind: 'email' | 'link';
  email?: string;
  role: AuroraRole;
  maxUses?: number;
  ttlDays?: number;
  invitedBy: string;
  inviterName?: string;
}) {
  const token = generateToken('inv');
  const email = input.kind === 'email' && input.email ? normalizeEmail(input.email) : null;
  const expiresAt = new Date(Date.now() + (input.ttlDays ?? INVITE_DEFAULT_TTL_DAYS) * 86400000);

  const invite = await prisma.client.auroraInvite.create({
    data: {
      id: uuid(),
      kind: input.kind,
      email,
      role: input.role,
      tokenHash: hashToken(token),
      maxUses: input.kind === 'email' ? 1 : Math.max(1, Math.min(input.maxUses ?? 10, 500)),
      expiresAt,
      invitedBy: input.invitedBy,
    },
  });

  let mail = null;

  if (email) {
    const message = inviteEmail({
      url: inviteUrl(token),
      role: input.role,
      inviter: input.inviterName,
      expiresAt,
    });
    mail = await sendMail({ kind: 'invite', to: [email], ...message });
    await prisma.client.auroraInvite.update({
      where: { id: invite.id },
      data: { lastSentAt: new Date() },
    });
  }

  return { invite, token, url: inviteUrl(token), mail };
}

/** Email invites: issue a fresh token (old link stops working) and resend. */
export async function resendInvite(inviteId: string, inviterName?: string) {
  const invite = await prisma.client.auroraInvite.findUnique({ where: { id: inviteId } });

  if (
    invite?.kind !== 'email' ||
    !invite.email ||
    ['revoked', 'accepted'].includes(inviteStatus(invite))
  ) {
    return null;
  }

  const token = generateToken('inv');
  const expiresAt = new Date(Date.now() + INVITE_DEFAULT_TTL_DAYS * 86400000);

  await prisma.client.auroraInvite.update({
    where: { id: invite.id },
    data: { tokenHash: hashToken(token), expiresAt, lastSentAt: new Date() },
  });

  const message = inviteEmail({
    url: inviteUrl(token),
    role: invite.role as AuroraRole,
    inviter: inviterName,
    expiresAt,
  });
  const mail = await sendMail({ kind: 'invite', to: [invite.email], ...message });

  return { mail, url: inviteUrl(token) };
}

export async function findValidInvite(token: string) {
  if (!token || token.length > 200) return null;

  const invite = await prisma.client.auroraInvite.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!invite || inviteStatus(invite) !== 'pending') {
    return null;
  }

  return invite;
}

export class InviteError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Accepts an invite: creates the user with the invite's role, records the email,
 * joins the organization. Atomic use-count increment prevents over-use races.
 */
export async function acceptInvite(input: {
  token: string;
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}) {
  const invite = await findValidInvite(input.token);

  if (!invite) {
    throw new InviteError('invalid-invite', 'La invitación no es válida o ya venció.');
  }

  const email = normalizeEmail(invite.email ?? input.email ?? '');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InviteError('email-required', 'Se requiere un email válido.');
  }

  const username = input.username.trim().toLowerCase();

  const [userTaken, emailTaken] = await Promise.all([
    prisma.client.user.findFirst({ where: { username } }),
    prisma.client.auroraUserProfile.findUnique({ where: { email } }),
  ]);

  if (userTaken) {
    throw new InviteError('username-taken', 'Ese nombre de usuario ya existe.');
  }
  if (emailTaken) {
    throw new InviteError('email-taken', 'Ese email ya tiene una cuenta.');
  }

  const orgId = await getOrgId();
  const { userRole, teamRole } =
    AURORA_ROLE_MAP[invite.role as AuroraRole] ?? AURORA_ROLE_MAP.viewer;
  const userId = uuid();

  await prisma.transaction(async (tx: any) => {
    const claimed = await tx.auroraInvite.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        uses: { lt: invite.maxUses },
      },
      data: { uses: { increment: 1 } },
    });

    if (claimed.count !== 1) {
      throw new InviteError('invalid-invite', 'La invitación ya fue usada.');
    }

    await tx.user.create({
      data: {
        id: userId,
        username,
        password: hashPassword(input.password),
        role: userRole,
        displayName: input.displayName?.trim() || null,
      },
    });
    await tx.auroraUserProfile.create({ data: { userId, email } });
    await tx.teamUser.create({ data: { id: uuid(), teamId: orgId, userId, role: teamRole } });
  });

  return prisma.client.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, role: true, password: true, createdAt: true },
  });
}
