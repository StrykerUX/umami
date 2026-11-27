// STUB (MCP fork): replaced by the real admin health details route from the health phase.
import { auroraRequest, errorJson } from '@/aurora/lib/api';

export async function GET(request: Request) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  return errorJson(501, 'not-implemented', 'Health details are not available yet.');
}
