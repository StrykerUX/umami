import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { isOAuthEnabled, LIMITS } from '@/aurora/oauth/config';
import { corsPreflight, OAUTH_CORS_HEADERS } from '@/aurora/oauth/metadata';
import { oauthJson, readOAuthBody } from '@/aurora/oauth/primitives';
import { revokeToken } from '@/aurora/oauth/service';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/** RFC 7009 token revocation. Always 200 (unknown tokens are ignored). */
export async function POST(request: Request) {
  if (!isOAuthEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (rateLimit(`oauth-revoke:${clientIp(request)}`, LIMITS.tokenPerIpPerMinute, 60_000)) {
    const body = await readOAuthBody(request);
    await revokeToken(body.token).catch(() => {});
  }

  return oauthJson({}, { headers: OAUTH_CORS_HEADERS });
}
