import { auroraRequest, errorJson, json } from '@/aurora/lib/api';
import { resendInvite } from '@/aurora/lib/invites';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ inviteId: string }> },
) {
  const { auth, error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const { inviteId } = await params;
  const result = await resendInvite(inviteId, auth.user.displayName || auth.user.username);

  if (!result) {
    return errorJson(400, 'not-resendable', 'Solo se reenvían invitaciones por email vigentes.');
  }

  return json({ ok: true, url: result.url, mailStatus: result.mail.status });
}
