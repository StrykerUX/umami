import {
  corsPreflight,
  metadataResponse,
  protectedResourceMetadata,
} from '@/aurora/oauth/metadata';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsPreflight();
}

/** AURORA: RFC 9728 protected resource metadata (path form for /mcp). */
export function GET() {
  return metadataResponse(protectedResourceMetadata);
}
