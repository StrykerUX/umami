import { checkServiceSecret } from '@/aurora/lib/access';
import { errorJson, json } from '@/aurora/lib/api';
import { uptimeResultsSchema } from '@/aurora/lib/schemas';
import { getUptimeTargets, ingestUptimeResults } from '@/aurora/lib/uptime';
import { getJsonBody } from '@/lib/request';
import { unauthorized } from '@/lib/response';

export const dynamic = 'force-dynamic';

/** Worker fetches the list of URLs to check. */
export async function GET(request: Request) {
  if (!checkServiceSecret(request)) {
    return unauthorized();
  }

  return json({ data: await getUptimeTargets() });
}

/** Worker posts check results. */
export async function POST(request: Request) {
  if (!checkServiceSecret(request)) {
    return unauthorized();
  }

  const parsed = uptimeResultsSchema.safeParse(await getJsonBody(request));

  if (!parsed.success) {
    return errorJson(400, 'bad-request', 'Payload inválido.');
  }

  return json(await ingestUptimeResults(parsed.data.results));
}
