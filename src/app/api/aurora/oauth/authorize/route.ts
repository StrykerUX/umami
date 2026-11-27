import { requireAurora } from '@/aurora/lib/access';
import { rateLimit } from '@/aurora/lib/rate-limit';
import { getIssuer, isOAuthEnabled } from '@/aurora/oauth/config';
import { OAuthError, oauthErrorResponse, oauthJson } from '@/aurora/oauth/primitives';
import {
  errorRedirect,
  issueAuthorizationCode,
  successRedirect,
  validateAuthorization,
} from '@/aurora/oauth/service';
import { parseRequest } from '@/lib/request';
import { forbidden, unauthorized } from '@/lib/response';

export const dynamic = 'force-dynamic';

const PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

function pick(source: Record<string, unknown>) {
  const params: Record<string, unknown> = {};

  for (const key of PARAMS) {
    if (source[key] !== undefined) params[key] = source[key];
  }

  return params;
}

/**
 * Consent requires an interactive Aurora session: never an API key, share token or OAuth token,
 * and never an account still on its default password.
 */
async function requireConsentSession(request: Request) {
  const { auth, error } = await parseRequest(request);

  if (error) return { error: error() };

  if (auth?.authType !== 'session' || !auth.user?.id) {
    return { error: unauthorized() };
  }

  if (auth.passwordChangeRequired) {
    return {
      error: forbidden({
        code: 'password-change-required',
        message: 'Cambia tu contraseña antes de conectar aplicaciones.',
      }),
    };
  }

  const { ctx, error: roleError } = await requireAurora(auth, 'viewer');

  if (roleError) return { error: roleError };

  return { user: auth.user, role: ctx.role };
}

/** Describes a pending authorization request for the consent screen. Never redirects. */
export async function GET(request: Request) {
  const issuer = getIssuer();

  if (!isOAuthEnabled() || !issuer) {
    return new Response(null, { status: 404 });
  }

  const session = await requireConsentSession(request);

  if (session.error) return session.error;

  try {
    const params = pick(Object.fromEntries(new URL(request.url).searchParams));
    const validated = await validateAuthorization(params, issuer);
    const redirect = new URL(validated.redirectUri);

    return oauthJson({
      client: {
        id: validated.client.id,
        name: validated.client.name,
        uri: validated.client.uri ?? null,
        registeredAt: validated.client.createdAt,
      },
      redirectHost: redirect.host,
      redirectUri: validated.redirectUri,
      resource: validated.resource,
      user: { username: session.user.username, role: session.role },
    });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

/** Records the decision and returns the URL the browser must navigate to. */
export async function POST(request: Request) {
  const issuer = getIssuer();

  if (!isOAuthEnabled() || !issuer) {
    return new Response(null, { status: 404 });
  }

  const session = await requireConsentSession(request);

  if (session.error) return session.error;

  if (!rateLimit(`oauth-authorize:${session.user.id}`, 30, 60_000)) {
    return oauthErrorResponse(
      new OAuthError('temporarily_unavailable', 'Too many requests.', { status: 429 }),
    );
  }

  let body: Record<string, unknown> = {};

  try {
    body = await request.json();
  } catch {
    return oauthErrorResponse(new OAuthError('invalid_request', 'Invalid body.'));
  }

  try {
    const validated = await validateAuthorization(pick(body ?? {}), issuer);

    if (body.decision !== 'approve') {
      return oauthJson({
        redirectUrl: errorRedirect(
          validated.redirectUri,
          new OAuthError('access_denied', 'The user denied the request.'),
          validated.state,
          issuer,
        ),
      });
    }

    const code = await issueAuthorizationCode(validated, session.user.id);

    return oauthJson({ redirectUrl: successRedirect(validated, code, issuer) });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
