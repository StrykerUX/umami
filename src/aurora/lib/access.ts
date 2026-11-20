import { forbidden, unauthorized } from '@/lib/response';
import { AURORA_ROLE_RANK, type AuroraRole } from './constants';
import { ensureMembership } from './org';
import { safeEqual } from './tokens';

export interface AuroraContext {
  userId: string;
  orgId: string;
  role: AuroraRole;
}

export function hasAuroraRole(role: AuroraRole, minimum: AuroraRole) {
  return AURORA_ROLE_RANK[role] >= AURORA_ROLE_RANK[minimum];
}

/**
 * Resolves the caller's Aurora context from a parsed Umami auth object.
 * Returns either `{ ctx }` or `{ error }` (a Response to return as-is).
 */
export async function requireAurora(
  auth: any,
  minimum: AuroraRole = 'viewer',
): Promise<{ ctx: AuroraContext; error?: undefined } | { ctx?: undefined; error: Response }> {
  const user = auth?.user;

  if (!user?.id) {
    return { error: unauthorized() };
  }

  const { orgId, role } = await ensureMembership({ id: user.id, role: user.role });

  if (!hasAuroraRole(role, minimum)) {
    return { error: forbidden({ message: 'Insufficient Aurora role.' }) };
  }

  return { ctx: { userId: user.id, orgId, role } };
}

/** Service-to-service auth (cron + uptime worker) using AURORA_CRON_SECRET. */
export function checkServiceSecret(request: Request) {
  const expected = process.env.AURORA_CRON_SECRET;

  if (!expected || expected.length < 16) {
    return false;
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  return !!token && safeEqual(token, expected);
}
