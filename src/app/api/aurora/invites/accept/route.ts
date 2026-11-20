import { z } from 'zod';
import { errorJson, json } from '@/aurora/lib/api';
import { acceptInvite, findValidInvite, InviteError } from '@/aurora/lib/invites';
import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { createSessionToken } from '@/lib/auth';
import { ROLES } from '@/lib/constants';
import { getJsonBody } from '@/lib/request';
import { getAllUserTeams } from '@/queries/prisma';

/** Public: validates an invite token so the sign-up page can show the role/email. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';

  if (!rateLimit(`invite-check:${clientIp(request)}`, 30, 60000)) {
    return errorJson(429, 'rate-limited', 'Demasiados intentos. Espera un momento.');
  }

  const invite = await findValidInvite(token);

  if (!invite) {
    return errorJson(404, 'invalid-invite', 'La invitación no es válida o ya venció.');
  }

  return json({
    kind: invite.kind,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
  });
}

const schema = z.object({
  token: z.string().min(10).max(200),
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._@-]+$/, 'Usa letras, números, punto, guion o @.'),
  password: z.string().min(8).max(255),
  displayName: z.string().trim().max(100).optional(),
  email: z.email().max(320).optional(),
});

/** Public: creates the account from an invite and logs the user in. */
export async function POST(request: Request) {
  if (!rateLimit(`invite-accept:${clientIp(request)}`, 10, 60000)) {
    return errorJson(429, 'rate-limited', 'Demasiados intentos. Espera un momento.');
  }

  const parsed = schema.safeParse(await getJsonBody(request));

  if (!parsed.success) {
    return errorJson(400, 'bad-request', parsed.error.issues[0]?.message ?? 'Datos inválidos.');
  }

  try {
    const user = await acceptInvite(parsed.data);

    if (!user) {
      return errorJson(500, 'server-error', 'No se pudo crear la cuenta.');
    }

    const token = await createSessionToken(user);
    const teams = await getAllUserTeams(user.id);

    return json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        isAdmin: user.role === ROLES.admin,
        passwordChangeRequired: false,
        teams,
      },
    });
  } catch (e) {
    if (e instanceof InviteError) {
      return errorJson(400, e.code, e.message);
    }
    throw e;
  }
}
