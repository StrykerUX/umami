/**
 * Aurora OAuth 2.1 authorization server for the embedded MCP endpoint (claude.ai connectors).
 *
 * Security posture:
 * - Issuer comes only from APP_URL / AURORA_OAUTH_ISSUER, never from request headers.
 * - Public clients only (PKCE S256 mandatory), dynamic registration (RFC 7591) with an allowlist
 *   of redirect hosts; no Client ID Metadata Documents (no server-side fetches of client URLs).
 * - Opaque access and refresh tokens, stored as SHA-256 hashes; refresh tokens rotate and reuse
 *   revokes the whole grant.
 */

export const AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Lifetime of the internal session token used to call API routes in-process. */
export const INTERNAL_SESSION_TTL_SECONDS = 5 * 60;

export const ACCESS_TOKEN_PREFIX = 'aat_';
export const REFRESH_TOKEN_PREFIX = 'art_';
export const MCP_RESOURCE_PATH = '/mcp';

export const OAUTH_SCOPE = 'mcp';
export const OAUTH_SCOPES = [OAUTH_SCOPE] as const;

/** Exact https redirect URIs accepted unless overridden. Loopback http is always allowed. */
export const DEFAULT_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];
/** A grant (connection) must be re-authorized after this, even while in use. */
export const GRANT_MAX_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
/** A rotated refresh token presented again within this window is rejected without revoking. */
export const REFRESH_REUSE_GRACE_SECONDS = 60;

export const LIMITS = {
  registerPerIpPerHour: 30,
  registerGlobalPerHour: 300,
  tokenPerIpPerMinute: 60,
  maxRedirectUris: 10,
} as const;

function trimSlash(value: string) {
  return value.replace(/\/+$/, '');
}

/** The OAuth issuer: AURORA_OAUTH_ISSUER or APP_URL. Null disables OAuth. */
export function getIssuer(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.AURORA_OAUTH_ISSUER || env.APP_URL || '').trim();

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
      return null;
    }

    return trimSlash(`${url.origin}${url.pathname}`);
  } catch {
    return null;
  }
}

export function isOAuthEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.MCP_ENABLED === '1' &&
    env.AURORA_OAUTH_DISABLED !== '1' &&
    !env.CLOUD_MODE &&
    !env.DISABLE_LOGIN &&
    !!getIssuer(env)
  );
}

export function getMcpResource(issuer: string) {
  return `${trimSlash(issuer)}${MCP_RESOURCE_PATH}`;
}

/** Exact https redirect URIs (normalized). Override with AURORA_OAUTH_REDIRECT_URIS (comma list). */
export function getAllowedRedirectUris(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.AURORA_OAUTH_REDIRECT_URIS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);
  const list = configured.length ? configured : DEFAULT_REDIRECT_URIS;

  return list.flatMap(u => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && !url.hash && !url.username && !url.password
        ? [url.href]
        : [];
    } catch {
      return [];
    }
  });
}

export function getEndpoints(issuer: string) {
  return {
    issuer,
    resource: getMcpResource(issuer),
    authorization: `${issuer}/oauth/authorize`,
    token: `${issuer}/api/aurora/oauth/token`,
    revocation: `${issuer}/api/aurora/oauth/revoke`,
    registration: `${issuer}/api/aurora/oauth/register`,
    authorizationServerMetadata: `${issuer}/.well-known/oauth-authorization-server`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`,
  };
}

/** Normalizes a resource indicator (RFC 8707) for comparison. */
export function normalizeResource(value: string) {
  try {
    const url = new URL(value);

    if (url.hash || url.search) {
      return null;
    }

    return trimSlash(url.toString());
  } catch {
    return null;
  }
}
