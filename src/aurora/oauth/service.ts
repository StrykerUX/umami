import debug from 'debug';
import { hash, secret, uuid } from '@/lib/crypto';
import { createSecureToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  AUTHORIZATION_CODE_TTL_SECONDS,
  GRANT_MAX_LIFETIME_SECONDS,
  getMcpResource,
  INTERNAL_SESSION_TTL_SECONDS,
  LIMITS,
  normalizeResource,
  OAUTH_SCOPE,
  REFRESH_REUSE_GRACE_SECONDS,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
} from './config';
import {
  appendRedirectParams,
  generateSecret,
  isAcceptableRedirectUri,
  isValidCodeChallenge,
  OAuthError,
  parseUrl,
  redirectUriMatches,
  sha256,
  verifyPkce,
} from './primitives';

const log = debug('umami:aurora:oauth');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = () => prisma.client as any;
const transaction = <T>(fn: (tx: any) => Promise<T>): Promise<T> =>
  prisma.transaction(fn) as Promise<T>;

/** Removes control, format (bidi overrides, zero-width), private-use and unassigned characters. */
function stripControlChars(value: string) {
  return value.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, '');
}

function optionalString(value: unknown, name: string, max = 2048) {
  if (value === undefined || value === null || value === '') return undefined;

  if (typeof value !== 'string' || value.length > max) {
    throw new OAuthError('invalid_request', `${name} is invalid.`);
  }

  return value;
}

function requireString(value: unknown, name: string, max = 2048) {
  const result = optionalString(value, name, max);

  if (!result) {
    throw new OAuthError('invalid_request', `${name} is required.`);
  }

  return result;
}

/** Password fingerprint: a password change invalidates every OAuth grant of the user. */
function passwordFingerprint(passwordHash: string) {
  return hash(passwordHash);
}

// ---------------------------------------------------------------------------
// Dynamic client registration (RFC 7591), public clients only
// ---------------------------------------------------------------------------

export async function registerClient(body: Record<string, unknown>) {
  const redirectUris = body.redirect_uris;

  if (
    !Array.isArray(redirectUris) ||
    !redirectUris.length ||
    redirectUris.length > LIMITS.maxRedirectUris
  ) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be a non-empty list.');
  }

  if (!redirectUris.every(uri => isAcceptableRedirectUri(uri))) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must be loopback http or https on an allowed host.',
    );
  }

  const name =
    typeof body.client_name === 'string'
      ? stripControlChars(body.client_name).trim().slice(0, 255)
      : '';

  if (!name) {
    throw new OAuthError('invalid_client_metadata', 'client_name is required.');
  }

  const clientUri = optionalString(body.client_uri, 'client_uri');

  if (clientUri && parseUrl(clientUri)?.protocol !== 'https:') {
    throw new OAuthError('invalid_client_metadata', 'client_uri must be https.');
  }

  const grantTypes = (body.grant_types as unknown[] | undefined) ?? [
    'authorization_code',
    'refresh_token',
  ];
  const responseTypes = (body.response_types as unknown[] | undefined) ?? ['code'];

  if (
    !Array.isArray(grantTypes) ||
    grantTypes.some(t => t !== 'authorization_code' && t !== 'refresh_token')
  ) {
    throw new OAuthError('invalid_client_metadata', 'Unsupported grant_types.');
  }

  if (!Array.isArray(responseTypes) || responseTypes.some(t => t !== 'code')) {
    throw new OAuthError('invalid_client_metadata', 'Unsupported response_types.');
  }

  const client = await db().auroraOAuthClient.create({
    data: { id: uuid(), name, redirectUris: [...new Set(redirectUris as string[])], clientUri },
  });

  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    // Public client: secrets are never issued, whatever was requested.
    token_endpoint_auth_method: 'none',
    grant_types: grantTypes,
    response_types: ['code'],
    scope: OAUTH_SCOPE,
    ...(clientUri ? { client_uri: clientUri } : {}),
  };
}

async function getClient(clientId: unknown) {
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) {
    throw new OAuthError('invalid_client', 'Unknown client_id.');
  }

  const client = await db().auroraOAuthClient.findUnique({ where: { id: clientId } });

  if (!client) {
    throw new OAuthError('invalid_client', 'Unknown client_id.');
  }

  return client as {
    id: string;
    name: string;
    redirectUris: string[];
    clientUri: string | null;
    createdAt: Date;
  };
}

// ---------------------------------------------------------------------------
// Authorization request + consent
// ---------------------------------------------------------------------------

export interface ValidatedAuthorization {
  client: { id: string; name: string; uri?: string; createdAt: Date };
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge: string;
  resource: string;
}

/**
 * Validates an authorization request. Errors before the redirect URI is validated are shown to
 * the user (never redirected); later errors are `redirectable`.
 */
export async function validateAuthorization(
  params: Record<string, unknown>,
  issuer: string,
): Promise<ValidatedAuthorization> {
  const client = await getClient(params.client_id);
  const requested = optionalString(params.redirect_uri, 'redirect_uri');
  const redirectUri = requested
    ? client.redirectUris.find(uri => redirectUriMatches(requested, uri))
      ? requested
      : null
    : client.redirectUris.length === 1
      ? client.redirectUris[0]
      : null;

  // Re-check against the current allowlist: a host may have been removed since registration.
  if (!redirectUri || !isAcceptableRedirectUri(redirectUri)) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uri is not registered for this client.');
  }

  const redirectable = { redirectable: true };

  if (params.response_type !== 'code') {
    throw new OAuthError(
      'unsupported_response_type',
      'response_type must be "code".',
      redirectable,
    );
  }

  if (!isValidCodeChallenge(params.code_challenge)) {
    throw new OAuthError('invalid_request', 'A PKCE code_challenge is required.', redirectable);
  }

  if (params.code_challenge_method !== 'S256') {
    throw new OAuthError('invalid_request', 'code_challenge_method must be "S256".', redirectable);
  }

  optionalString(params.scope, 'scope', 500);

  const expectedResource = getMcpResource(issuer);
  const resourceParam = optionalString(params.resource, 'resource');

  if (resourceParam && normalizeResource(resourceParam) !== expectedResource) {
    throw new OAuthError('invalid_target', `resource must be ${expectedResource}.`, redirectable);
  }

  return {
    client: {
      id: client.id,
      name: client.name,
      uri: client.clientUri ?? undefined,
      createdAt: client.createdAt,
    },
    redirectUri,
    // Only one scope exists; access is always bounded by the user's Aurora role.
    scope: OAUTH_SCOPE,
    state: optionalString(params.state, 'state', 1024),
    codeChallenge: params.code_challenge as string,
    resource: expectedResource,
  };
}

export async function issueAuthorizationCode(request: ValidatedAuthorization, userId: string) {
  const code = generateSecret(32);

  await db().auroraOAuthCode.create({
    data: {
      id: uuid(),
      codeHash: sha256(code),
      userId,
      clientId: request.client.id,
      redirectUri: request.redirectUri,
      scope: request.scope,
      resource: request.resource,
      codeChallenge: request.codeChallenge,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
    },
  });

  return code;
}

export function successRedirect(request: ValidatedAuthorization, code: string, issuer: string) {
  return appendRedirectParams(request.redirectUri, { code, state: request.state, iss: issuer });
}

export function errorRedirect(
  redirectUri: string,
  error: OAuthError,
  state: string | undefined,
  issuer: string,
) {
  return appendRedirectParams(redirectUri, {
    error: error.code,
    error_description: error.message,
    state,
    iss: issuer,
  });
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function grantEndsAt(grant: { createdAt: Date }) {
  return grant.createdAt.getTime() + GRANT_MAX_LIFETIME_SECONDS * 1000;
}

async function issueTokens(
  grant: { id: string; scope: string; createdAt: Date },
  tx: any,
): Promise<TokenResponse> {
  const access = `${ACCESS_TOKEN_PREFIX}${generateSecret(32)}`;
  const refresh = `${REFRESH_TOKEN_PREFIX}${generateSecret(32)}`;
  const now = Date.now();
  const grantId = grant.id;
  const scope = grant.scope;
  const end = grantEndsAt(grant);
  const accessExpires = Math.min(now + ACCESS_TOKEN_TTL_SECONDS * 1000, end);

  await tx.auroraOAuthToken.createMany({
    data: [
      {
        id: uuid(),
        grantId,
        kind: 'access',
        tokenHash: sha256(access),
        expiresAt: new Date(accessExpires),
      },
      {
        id: uuid(),
        grantId,
        kind: 'refresh',
        tokenHash: sha256(refresh),
        // A connection never outlives GRANT_MAX_LIFETIME_SECONDS, however often it refreshes.
        expiresAt: new Date(Math.min(now + REFRESH_TOKEN_TTL_SECONDS * 1000, end)),
      },
    ],
  });

  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((accessExpires - now) / 1000)),
    refresh_token: refresh,
    scope,
  };
}

export async function revokeGrant(grantId: string, reason: string, tx: any = db()) {
  const now = new Date();

  await tx.auroraOAuthGrant.updateMany({
    where: { id: grantId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
  await tx.auroraOAuthToken.updateMany({
    where: { grantId, revokedAt: null },
    data: { revokedAt: now },
  });
}

type ActiveUser = { id: string; role: string; password: string };

/**
 * The user behind a grant, or why it cannot act: removed (soft-deleted / gone) or blocked
 * (2FA required but not enrolled, so a session could not act either).
 */
async function loadActiveUser(
  userId: string,
  client: any = db(),
): Promise<{ user: ActiveUser | null; reason?: 'removed' | 'blocked' }> {
  const user = await client.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, password: true, twoFactorRequired: true },
  });

  if (!user?.id) return { user: null, reason: 'removed' };

  if (user.twoFactorRequired) {
    const twoFactor = await client.twoFactorAuth.findUnique({ where: { userId } });

    if (!twoFactor?.isEnabled) return { user: null, reason: 'blocked' };
  }

  return { user: { id: user.id, role: user.role, password: user.password } };
}

export async function authorizationCodeGrant(
  params: Record<string, unknown>,
  issuer: string,
): Promise<TokenResponse> {
  const code = requireString(params.code, 'code', 512);
  const clientId = requireString(params.client_id, 'client_id', 64);
  const redirectUri = requireString(params.redirect_uri, 'redirect_uri');
  const verifier = requireString(params.code_verifier, 'code_verifier', 128);
  const invalid = () =>
    new OAuthError('invalid_grant', 'Authorization code is invalid, expired or already used.');

  let newGrant: { userId: string; clientName: string; redirectUri: string } | null = null;

  // Errors are returned (not thrown) so the code is burned even when validation fails.
  const result = await transaction<TokenResponse | OAuthError>(async tx => {
    const now = new Date();
    const codeHash = sha256(code);
    const { count } = await tx.auroraOAuthCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    const record = await tx.auroraOAuthCode.findUnique({ where: { codeHash } });

    if (!record) return invalid();

    if (count !== 1) {
      if (record.usedAt && record.grantId) {
        // Replay of a redeemed code: revoke everything it produced (OAuth 2.1 §4.1.2).
        log('authorization code replay; revoking grant %s', record.grantId);
        await revokeGrant(record.grantId, 'code_replay', tx);
      }

      return invalid();
    }

    if (record.clientId !== clientId) {
      return new OAuthError('invalid_grant', 'client_id does not match the authorization code.');
    }

    if (redirectUri !== record.redirectUri) {
      return new OAuthError('invalid_grant', 'redirect_uri does not match the authorization.');
    }

    if (!verifyPkce(verifier, record.codeChallenge)) {
      return new OAuthError('invalid_grant', 'PKCE verification failed.');
    }

    const resource = optionalString(params.resource, 'resource');

    if (resource && normalizeResource(resource) !== record.resource) {
      return new OAuthError('invalid_target', `resource must be ${record.resource}.`);
    }

    if (record.resource !== getMcpResource(issuer)) {
      return invalid();
    }

    const { user } = await loadActiveUser(record.userId, tx);
    const client = await tx.auroraOAuthClient.findUnique({ where: { id: record.clientId } });

    if (!user || !client) {
      return new OAuthError('invalid_grant', 'The account or client is no longer available.');
    }

    const grantId = uuid();

    const grant = await tx.auroraOAuthGrant.create({
      data: {
        id: grantId,
        userId: user.id,
        clientId: client.id,
        clientName: client.name,
        scope: record.scope,
        resource: record.resource,
        pwdFingerprint: passwordFingerprint(user.password),
        lastUsedAt: now,
      },
    });
    await tx.auroraOAuthCode.update({ where: { id: record.id }, data: { grantId } });
    await tx.auroraOAuthClient.update({ where: { id: client.id }, data: { lastUsedAt: now } });

    newGrant = { userId: user.id, clientName: client.name, redirectUri: record.redirectUri };

    return issueTokens(grant, tx);
  });

  if (result instanceof OAuthError) throw result;

  if (newGrant) {
    // Out of band, after commit: tell the user a new app can act as them.
    await notifyNewGrant(newGrant).catch(e => log('grant notification failed: %s', e?.message));
  }

  return result;
}

/** Emails the account owner when an app is connected (consent-phishing tripwire). */
async function notifyNewGrant(grant: { userId: string; clientName: string; redirectUri: string }) {
  const profile = await db().auroraUserProfile.findUnique({ where: { userId: grant.userId } });

  if (!profile?.email) return;

  const [{ sendMail }, { oauthGrantEmail }, { getAppUrl }] = await Promise.all([
    import('@/aurora/lib/mailer'),
    import('@/aurora/emails/templates'),
    import('@/aurora/lib/constants'),
  ]);
  const mail = oauthGrantEmail({
    clientName: grant.clientName,
    redirectHost: new URL(grant.redirectUri).host,
    manageUrl: `${getAppUrl()}/aurora/connections`,
  });

  await sendMail({ kind: 'oauth_grant', to: [profile.email], ...mail });
}

export async function refreshTokenGrant(params: Record<string, unknown>): Promise<TokenResponse> {
  const token = requireString(params.refresh_token, 'refresh_token', 512);
  const clientId = requireString(params.client_id, 'client_id', 64);
  const invalid = () =>
    new OAuthError('invalid_grant', 'Refresh token is invalid, expired or revoked.');

  if (!token.startsWith(REFRESH_TOKEN_PREFIX)) throw invalid();

  const result = await transaction<TokenResponse | OAuthError>(async tx => {
    const now = new Date();
    const record = await tx.auroraOAuthToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { grant: true },
    });

    if (record?.kind !== 'refresh') return invalid();

    const { grant } = record;

    if (record.usedAt || record.revokedAt) {
      // A rotated refresh token came back: assume theft and kill the whole grant, unless it is
      // a near-immediate retry (lost response / concurrent refresh), which just fails.
      const inGrace =
        record.usedAt &&
        now.getTime() - record.usedAt.getTime() < REFRESH_REUSE_GRACE_SECONDS * 1000;

      if (record.usedAt && !grant.revokedAt && !inGrace) {
        log('refresh token reuse; revoking grant %s', grant.id);
        await revokeGrant(grant.id, 'refresh_reuse', tx);
      }

      return invalid();
    }

    if (grant.revokedAt || record.expiresAt <= now) return invalid();

    if (grantEndsAt(grant) <= now.getTime()) {
      await revokeGrant(grant.id, 'expired', tx);
      return invalid();
    }

    if (grant.clientId !== clientId) {
      return new OAuthError('invalid_grant', 'client_id does not match the refresh token.');
    }

    const resource = optionalString(params.resource, 'resource');

    if (resource && normalizeResource(resource) !== grant.resource) {
      return new OAuthError('invalid_target', `resource must be ${grant.resource}.`);
    }

    const loaded = await loadActiveUser(grant.userId, tx);

    if (!loaded.user) {
      // 2FA not enrolled: refuse but keep the grant (enrolling restores access).
      if (loaded.reason === 'removed') await revokeGrant(grant.id, 'user_removed', tx);
      return invalid();
    }

    if (passwordFingerprint(loaded.user.password) !== grant.pwdFingerprint) {
      await revokeGrant(grant.id, 'password_changed', tx);
      return invalid();
    }

    // Rotate atomically: only one concurrent request can retire this token.
    const { count } = await tx.auroraOAuthToken.updateMany({
      where: { id: record.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    });

    if (count !== 1) {
      // Lost a concurrent race for the same token: fail without revoking (the winner holds it).
      return invalid();
    }

    await tx.auroraOAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } });

    return issueTokens(grant, tx);
  });

  if (result instanceof OAuthError) throw result;

  return result;
}

export async function handleTokenRequest(params: Record<string, unknown>, issuer: string) {
  switch (params.grant_type) {
    case 'authorization_code':
      return authorizationCodeGrant(params, issuer);
    case 'refresh_token':
      return refreshTokenGrant(params);
    default:
      throw new OAuthError(
        'unsupported_grant_type',
        'grant_type must be "authorization_code" or "refresh_token".',
      );
  }
}

/** RFC 7009: unknown tokens are accepted silently. A refresh token revokes the whole grant. */
export async function revokeToken(token: unknown) {
  if (typeof token !== 'string' || token.length > 512) return;

  const record = await db().auroraOAuthToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (!record) return;

  if (record.kind === 'refresh') {
    await revokeGrant(record.grantId, 'client_revoked');
  } else {
    await db().auroraOAuthToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// ---------------------------------------------------------------------------
// Access token verification (MCP endpoint)
// ---------------------------------------------------------------------------

export function looksLikeAccessToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.startsWith(ACCESS_TOKEN_PREFIX) && token.length < 200;
}

export interface VerifiedAccess {
  userId: string;
  role: string;
  clientId: string;
  grantId: string;
  /** Short-lived session token used only in-process to call the API routes as this user. */
  internalToken: string;
}

export async function verifyAccessToken(
  token: string,
  issuer: string,
): Promise<VerifiedAccess | null> {
  const record = await db().auroraOAuthToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { grant: true },
  });
  const now = new Date();

  if (
    record?.kind !== 'access' ||
    record.revokedAt ||
    record.expiresAt <= now ||
    record.grant.revokedAt ||
    record.grant.resource !== getMcpResource(issuer) ||
    grantEndsAt(record.grant) <= now.getTime()
  ) {
    return null;
  }

  const { grant } = record;
  const loaded = await loadActiveUser(grant.userId);

  if (!loaded.user) {
    if (loaded.reason === 'removed') await revokeGrant(grant.id, 'user_removed');
    return null;
  }

  const user = loaded.user;

  if (passwordFingerprint(user.password) !== grant.pwdFingerprint) {
    await revokeGrant(grant.id, 'password_changed');
    return null;
  }

  // Avoid a write per request: refresh lastUsedAt at most every 5 minutes.
  if (!grant.lastUsedAt || now.getTime() - grant.lastUsedAt.getTime() > 5 * 60_000) {
    await db()
      .auroraOAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: now } })
      .catch(() => {});
  }

  const internalToken = createSecureToken(
    { userId: user.id, role: user.role, pwd: hash(user.password) },
    secret(),
    { expiresIn: INTERNAL_SESSION_TTL_SECONDS },
  ) as string;

  return {
    userId: user.id,
    role: user.role,
    clientId: grant.clientId,
    grantId: grant.id,
    internalToken,
  };
}

// ---------------------------------------------------------------------------
// Connected apps (management) + housekeeping
// ---------------------------------------------------------------------------

export async function listGrants(options: { userId?: string }) {
  const grants = await db().auroraOAuthGrant.findMany({
    where: { revokedAt: null, ...(options.userId ? { userId: options.userId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const userIds = [...new Set(grants.map((g: any) => g.userId))] as string[];
  const users = await prisma.client.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const names = new Map(users.map(u => [u.id, u.username]));

  return grants.map((g: any) => ({
    id: g.id,
    clientName: g.clientName,
    userId: g.userId,
    username: names.get(g.userId) ?? null,
    createdAt: g.createdAt,
    lastUsedAt: g.lastUsedAt,
  }));
}

export async function getGrant(grantId: string) {
  if (!UUID_RE.test(grantId)) return null;

  return db().auroraOAuthGrant.findUnique({ where: { id: grantId } });
}

export async function pruneOAuth(now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const old = new Date(now.getTime() - day);
  const [codes, tokens, grants, clients] = [
    await db().auroraOAuthCode.deleteMany({ where: { expiresAt: { lt: old } } }),
    await db().auroraOAuthToken.deleteMany({ where: { expiresAt: { lt: old } } }),
    // Revoked a month ago, or idle past the refresh-token lifetime (nothing can use them).
    await db().auroraOAuthGrant.deleteMany({
      where: {
        OR: [
          { revokedAt: { lt: new Date(now.getTime() - 30 * day) } },
          { lastUsedAt: { lt: new Date(now.getTime() - 31 * day) } },
        ],
      },
    }),
    // Registrations that were never used to complete an authorization.
    await db().auroraOAuthClient.deleteMany({
      where: { lastUsedAt: null, createdAt: { lt: new Date(now.getTime() - 7 * day) } },
    }),
  ];

  return { codes: codes.count, tokens: tokens.count, grants: grants.count, clients: clients.count };
}
