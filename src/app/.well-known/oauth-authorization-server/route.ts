import {
  authorizationServerMetadata,
  corsPreflight,
  metadataResponse,
} from '@/aurora/oauth/metadata';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/** AURORA: RFC 8414 authorization server metadata for the MCP OAuth flow. */
export function GET() {
  return metadataResponse(authorizationServerMetadata);
}
