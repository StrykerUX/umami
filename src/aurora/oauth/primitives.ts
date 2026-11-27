import crypto from 'node:crypto';
import { getAllowedRedirectUris } from './config';

// ---------------------------------------------------------------------------
// Errors (RFC 6749 §5.2)
// ---------------------------------------------------------------------------

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri';

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly status: number;
  /** True once the redirect URI is validated: the error may be sent back to the client. */
  readonly redirectable: boolean;

  constructor(
    code: OAuthErrorCode,
    description: string,
    options: { status?: number; redirectable?: boolean } = {},
  ) {
    super(description);
    this.name = 'OAuthError';
    this.code = code;
    this.status =
      options.status ??
      (code === 'invalid_client'
        ? 401
        : code === 'server_error'
          ? 500
          : code === 'temporarily_unavailable'
            ? 503
            : 400);
    this.redirectable = options.redirectable ?? false;
  }

  toJSON() {
    return { error: this.code, error_description: this.message };
  }
}

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };

export function oauthJson(body: unknown, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE, ...(init.headers as Record<string, string>) },
  });
}

export function oauthErrorResponse(error: unknown) {
  if (error instanceof OAuthError) {
    const headers: Record<string, string> = {};

    if (error.status === 401) {
      headers['www-authenticate'] = `Bearer error="${error.code}"`;
    }

    return oauthJson(error.toJSON(), { status: error.status, headers });
  }

  return oauthJson(
    { error: 'server_error', error_description: 'Unexpected error.' },
    { status: 500 },
  );
}

/** Token/revocation/registration bodies: form-encoded (RFC 6749) or JSON. First value wins. */
export async function readOAuthBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();

      return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    }

    const params = new URLSearchParams(await request.text());
    const result: Record<string, unknown> = {};

    for (const [key, value] of params) {
      if (!(key in result)) result[key] = value;
    }

    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Secrets, hashing, PKCE (RFC 7636, S256 only)
// ---------------------------------------------------------------------------

export function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === 'string' && CHALLENGE_PATTERN.test(value);
}

export function computeCodeChallenge(verifier: string) {
  return crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function verifyPkce(verifier: unknown, challenge: string) {
  if (typeof verifier !== 'string' || !VERIFIER_PATTERN.test(verifier)) {
    return false;
  }

  const expected = Buffer.from(challenge);
  const actual = Buffer.from(computeCodeChallenge(verifier));

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Redirect URIs
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopbackUrl(url: URL) {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Accepted redirect URIs: loopback http (native clients such as Claude Code), or one of the exact
 * allowlisted https URIs (Claude's OAuth callbacks by default). No wildcards, fragments,
 * credentials or custom schemes.
 */
export function isAcceptableRedirectUri(value: unknown, env: NodeJS.ProcessEnv = process.env) {
  const url = parseUrl(value);

  if (!url || url.hash || url.username || url.password) {
    return false;
  }

  if (isLoopbackUrl(url)) {
    return true;
  }

  if (url.protocol !== 'https:' || value !== url.href) {
    return false;
  }

  return getAllowedRedirectUris(env).includes(url.href);
}

/** Exact match, except loopback URIs may vary the port (RFC 8252 §7.3). */
export function redirectUriMatches(candidate: string, registered: string) {
  if (candidate === registered) {
    return true;
  }

  const left = parseUrl(candidate);
  const right = parseUrl(registered);

  if (!left || !right || !isLoopbackUrl(left) || !isLoopbackUrl(right)) {
    return false;
  }

  return (
    left.hostname === right.hostname &&
    left.pathname === right.pathname &&
    left.search === right.search
  );
}

export function appendRedirectParams(
  redirectUri: string,
  params: Record<string, string | undefined>,
) {
  const url = new URL(redirectUri);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  return url.toString();
}
