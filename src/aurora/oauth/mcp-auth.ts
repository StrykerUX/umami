import type { AuthInfo } from '@umami/mcp';
import { authenticateMcpRequest } from '@/lib/mcp/auth';
import {
  ACCESS_TOKEN_PREFIX,
  getEndpoints,
  getIssuer,
  isOAuthEnabled,
  OAUTH_SCOPE,
} from './config';

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') ?? '';

  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined;
}

export type AuroraMcpAuth =
  | { ok: true; authInfo: AuthInfo }
  | { ok: false; error: string; description: string };

/**
 * MCP authentication: Aurora OAuth access tokens (claude.ai connectors) or Umami API keys.
 * OAuth callers get a short-lived internal session token that never leaves this process; the
 * MCP tools reach the API through the in-process dispatch allowlists only.
 */
export async function authenticateAuroraMcp(request: Request): Promise<AuroraMcpAuth> {
  const token = bearerToken(request);
  const issuer = getIssuer();

  if (token?.startsWith(ACCESS_TOKEN_PREFIX)) {
    if (!isOAuthEnabled() || !issuer) {
      return { ok: false, error: 'invalid_token', description: 'Invalid access token.' };
    }

    // Lazy: keeps prisma out of module scope for callers that never see an OAuth token.
    const { verifyAccessToken } = await import('./service');
    const verified = await verifyAccessToken(token, issuer);

    if (!verified) {
      return { ok: false, error: 'invalid_token', description: 'Invalid or expired access token.' };
    }

    return {
      ok: true,
      authInfo: {
        token: verified.internalToken,
        clientId: `oauth:${verified.clientId}`,
        scopes: [OAUTH_SCOPE],
        extra: { userId: verified.userId, authType: 'oauth', grantId: verified.grantId },
      },
    };
  }

  const result = await authenticateMcpRequest(request);

  if (result.ok) {
    return { ok: true, authInfo: result.authInfo };
  }

  const failure = result as Extract<typeof result, { ok: false }>;

  return { ok: false, error: failure.error, description: failure.description };
}

/** 401 that points MCP clients at the protected resource metadata (RFC 9728 §5.1). */
export function auroraMcpUnauthorized(result: AuroraMcpAuth) {
  const auth = result as Extract<AuroraMcpAuth, { ok: false }>;
  const issuer = getIssuer();
  const parts = [`Bearer realm="Aurora MCP"`, `error="${auth.error}"`];

  if (isOAuthEnabled() && issuer) {
    parts.push(`resource_metadata="${getEndpoints(issuer).protectedResourceMetadata}"`);
  }

  return Response.json(
    { error: auth.error, error_description: auth.description },
    {
      status: 401,
      headers: {
        'www-authenticate': parts.join(', '),
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'www-authenticate',
      },
    },
  );
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const SECRET_FIELDS = ['token', 'authKey', 'shareToken'];

/**
 * Wraps the MCP in-process fetch so credentials never flow back to tools (and from there to the
 * model): `/api/me` echoes the caller's auth object, including the bearer token, which for OAuth
 * callers is the internal session token.
 */
export function withoutCredentialEcho<F extends FetchLike>(inner: F): F {
  return (async (input: string | URL, init?: RequestInit) => {
    const res = await inner(input, init);
    let path = '';

    try {
      path = new URL(String(input), 'http://localhost').pathname;
    } catch {}

    if (!/\/api\/me\/?$/.test(path)) return res;

    const data = await res
      .clone()
      .json()
      .catch(() => null);

    if (!data || typeof data !== 'object' || Array.isArray(data)) return res;

    for (const field of SECRET_FIELDS) delete (data as Record<string, unknown>)[field];

    const headers = new Headers(res.headers);
    headers.delete('content-length');

    return new Response(JSON.stringify(data), { status: res.status, headers });
  }) as F;
}
