import { z } from 'zod';
import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { AURORA_ROLES } from '@/aurora/lib/constants';
import { setMemberRole } from '@/aurora/lib/org';
import { ROLES } from '@/lib/constants';
import prisma from '@/lib/prisma';
import { deleteUser } from '@/queries/prisma';

async function loadMember(orgId: string, userId: string) {
  return prisma.client.teamUser.findFirst({ where: { teamId: orgId, userId } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const schema = z.object({ role: z.enum(AURORA_ROLES) });
  const { ctx, body, error } = await auroraRequest<z.infer<typeof schema>>(
    request,
    schema,
    'admin',
  );

  if (error) {
    return error;
  }

  const { userId } = await params;
  const member = await loadMember(ctx.orgId, userId);

  if (!member) {
    return errorJson(404, 'not-found', 'Miembro no encontrado.');
  }

  if (userId === ctx.userId && body.role !== 'admin') {
    return errorJson(400, 'self-demote', 'No puedes quitarte el rol de admin a ti mismo.');
  }

  if (member.role === ROLES.teamOwner && body.role !== 'admin') {
    return errorJson(400, 'owner', 'El dueño de la organización debe ser admin.');
  }

  await setMemberRole(userId, body.role, ctx.orgId);

  return json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { ctx, error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { userId } = await params;
  const member = await loadMember(ctx.orgId, userId);

  if (!member) {
    return errorJson(404, 'not-found', 'Miembro no encontrado.');
  }

  if (userId === ctx.userId || member.role === ROLES.teamOwner) {
    return errorJson(400, 'protected', 'Este miembro no se puede eliminar.');
  }

  // Removing a member deletes the account (single organization: no account without org).
  await prisma.client.auroraUserProfile.deleteMany({ where: { userId } });
  await prisma.client.auroraPasswordReset.deleteMany({ where: { userId } });
  await deleteUser(userId);

  return json({ ok: true });
}
