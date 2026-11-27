import { auroraRequest } from '@/aurora/lib/api';
import { runHealthChecks } from '@/aurora/lib/health';

export const dynamic = 'force-dynamic';

/** Full health report for Aurora admins (UI and MCP). Always 200 so the UI can render `down`. */
export async function GET(request: Request) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  return Response.json(await runHealthChecks(), { headers: { 'cache-control': 'no-store' } });
}
