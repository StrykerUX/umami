import { clientIp, rateLimit } from '@/aurora/lib/rate-limit';
import { isOAuthEnabled, LIMITS } from '@/aurora/oauth/config';
import { corsPreflight, OAUTH_CORS_HEADERS } from '@/aurora/oauth/metadata';
import {
  OAuthError,
  oauthErrorResponse,
  oauthJson,
  readOAuthBody,
} from '@/aurora/oauth/primitives';
import { registerClient } from '@/aurora/oauth/service';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;

export function OPTIONS() {
  return corsPreflight();
}

/** Dynamic client registration (RFC 7591). Public clients, allowlisted redirect hosts only. */
export async function POST(request: Request) {
  if (!isOAuthEnabled()) {
    return new Response(null, { status: 404 });
  }

  const ip = clientIp(request);

  // Per-IP limit plus a global cap, so spoofed IP headers cannot flood registrations.
  if (
    !rateLimit(`oauth-register:${ip}`, LIMITS.registerPerIpPerHour, HOUR) ||
    !rateLimit('oauth-register:global', LIMITS.registerGlobalPerHour, HOUR)
  ) {
    return oauthErrorResponse(
      new OAuthError('temporarily_unavailable', 'Too many registrations. Try again later.', {
        status: 429,
      }),
    );
  }

  try {
    const body = await readOAuthBody(request);
    const client = await registerClient(body);

    return oauthJson(client, { status: 201, headers: OAUTH_CORS_HEADERS });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
