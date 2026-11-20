import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import prisma from '@/lib/prisma';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { inviteId } = await params;
  const { count } = await prisma.client.auroraInvite.updateMany({
    where: { id: inviteId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (!count) {
    return errorJson(404, 'not-found', 'Invitación no encontrada.');
  }

  return json({ ok: true });
}
