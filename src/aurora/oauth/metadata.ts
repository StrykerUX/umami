import { getEndpoints, getIssuer, isOAuthEnabled, OAUTH_SCOPES } from './config';

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(issuer: string) {
  const e = getEndpoints(issuer);

  return {
    issuer: e.issuer,
    authorization_endpoint: e.authorization,
    token_endpoint: e.token,
    revocation_endpoint: e.revocation,
    registration_endpoint: e.registration,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  };
}

/** RFC 9728 protected resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(issuer: string) {
  const e = getEndpoints(issuer);

  return {
    resource: e.resource,
    resource_name: 'Aurora Analytics MCP',
    authorization_servers: [e.issuer],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ['header'],
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Serves a metadata document, or 404 when OAuth is disabled. */
export function metadataResponse(build: (issuer: string) => unknown) {
  const issuer = getIssuer();

  if (!isOAuthEnabled() || !issuer) {
    return new Response(null, { status: 404 });
  }

  return Response.json(build(issuer), {
    headers: { ...CORS, 'cache-control': 'public, max-age=300' },
  });
}

export { CORS as OAUTH_CORS_HEADERS };
