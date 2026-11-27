import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { getIssuer, isOAuthEnabled, LIMITS } from '@/aurora/oauth/config';
import { corsPreflight, OAUTH_CORS_HEADERS } from '@/aurora/oauth/metadata';
import {
  OAuthError,
  oauthErrorResponse,
  oauthJson,
  readOAuthBody,
} from '@/aurora/oauth/primitives';
import { handleTokenRequest } from '@/aurora/oauth/service';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/** OAuth 2.1 token endpoint: authorization_code (PKCE) and refresh_token (rotating). */
export async function POST(request: Request) {
  const issuer = getIssuer();

  if (!isOAuthEnabled() || !issuer) {
    return new Response(null, { status: 404 });
  }

  if (!rateLimit(`oauth-token:${clientIp(request)}`, LIMITS.tokenPerIpPerMinute, 60_000)) {
    return oauthErrorResponse(
      new OAuthError('temporarily_unavailable', 'Too many requests.', { status: 429 }),
    );
  }

  try {
    const tokens = await handleTokenRequest(await readOAuthBody(request), issuer);

    return oauthJson(tokens, { headers: OAUTH_CORS_HEADERS });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
