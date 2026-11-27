import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { getGrant, revokeGrant } from '@/aurora/oauth/service';

export const dynamic = 'force-dynamic';

/** Revokes a connected app: own grants, or any grant for admins. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ grantId: string }> },
) {
  const { ctx, error } = await auroraRequest(request);

  if (error) return error;

  const { grantId } = await params;
  const grant = await getGrant(grantId);

  if (!grant || grant.revokedAt || (grant.userId !== ctx.userId && ctx.role !== 'admin')) {
    return errorJson(404, 'not_found', 'Conexión no encontrada.');
  }

  await revokeGrant(grant.id, grant.userId === ctx.userId ? 'user_revoked' : 'admin_revoked');

  return json({ ok: true });
}
