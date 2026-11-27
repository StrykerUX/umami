import { auroraRequest, json } from '@/aurora/lib/api';
import { listGrants } from '@/aurora/oauth/service';

export const dynamic = 'force-dynamic';

/** Connected apps. Everyone sees their own; admins can list all with ?all=1. */
export async function GET(request: Request) {
  const { ctx, error } = await auroraRequest(request);

  if (error) return error;

  const all = new URL(request.url).searchParams.get('all') === '1' && ctx.role === 'admin';

  return json({ data: await listGrants(all ? {} : { userId: ctx.userId }) });
}
