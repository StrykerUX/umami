import { auroraRequest, json } from '@/aurora/lib/api';
import { migratePersonalToOrg } from '@/aurora/lib/org';

export async function POST(request: Request) {
  const { error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  return json(await migratePersonalToOrg({ force: true }));
}
