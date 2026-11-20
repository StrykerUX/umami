import { z } from 'zod';
import { auroraRequest, json } from '@/aurora/lib/api';
import { AURORA_ROLES } from '@/aurora/lib/constants';
import { createInvite, inviteStatus } from '@/aurora/lib/invites';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const invites = await prisma.client.auroraInvite.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return json({
    data: invites.map(({ tokenHash: _t, ...invite }) => ({
      ...invite,
      status: inviteStatus(invite),
    })),
  });
}

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    email: z.email().max(320),
    role: z.enum(AURORA_ROLES),
  }),
  z.object({
    kind: z.literal('link'),
    role: z.enum(AURORA_ROLES),
    maxUses: z.number().int().min(1).max(500).default(10),
    ttlDays: z.number().int().min(1).max(90).default(7),
  }),
]);

export async function POST(request: Request) {
  const { ctx, body, auth, error } = await auroraRequest<z.infer<typeof schema>>(
    request,
    schema,
    'admin',
  );

  if (error) {
    return error;
  }

  if (body.kind === 'email') {
    const existing = await prisma.client.auroraUserProfile.findUnique({
      where: { email: body.email.trim().toLowerCase() },
    });

    if (existing) {
      return Response.json(
        { error: { code: 'email-taken', message: 'Ese email ya tiene una cuenta.', status: 400 } },
        { status: 400 },
      );
    }
  }

  const { invite, url, mail } = await createInvite({
    ...body,
    invitedBy: ctx.userId,
    inviterName: auth.user.displayName || auth.user.username,
  });

  const { tokenHash: _t, ...safe } = invite;

  return json({
    invite: { ...safe, status: inviteStatus(invite) },
    url,
    mailStatus: mail?.status ?? null,
  });
}
