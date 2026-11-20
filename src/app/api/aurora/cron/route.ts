import { checkServiceSecret } from '@/aurora/lib/access';
import { json } from '@/aurora/lib/api';
import { runDueSchedules } from '@/aurora/lib/report';
import { pruneUptimeChecks } from '@/aurora/lib/uptime';
import { unauthorized } from '@/lib/response';

export const dynamic = 'force-dynamic';

/** Called by the scheduler worker (Bearer AURORA_CRON_SECRET). Idempotent per schedule. */
export async function POST(request: Request) {
  if (!checkServiceSecret(request)) {
    return unauthorized();
  }

  const reports = await runDueSchedules(new Date());
  const pruned = await pruneUptimeChecks();

  return json({ reports, pruned });
}
