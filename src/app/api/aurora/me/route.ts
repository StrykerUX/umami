import { auroraRequest, json } from '@/aurora/lib/api';
import { migratePersonalToOrg } from '@/aurora/lib/org';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { ctx, error } = await auroraRequest(request);

  if (error) {
    return error;
  }

  // First admin visit moves any personal entities into the organization (runs once).
  if (ctx.role === 'admin') {
    await migratePersonalToOrg();
  }

  const [team, profile] = await Promise.all([
    prisma.client.team.findUnique({
      where: { id: ctx.orgId },
      select: { name: true, logoUrl: true },
    }),
    prisma.client.auroraUserProfile.findUnique({ where: { userId: ctx.userId } }),
  ]);

  return json({
    orgId: ctx.orgId,
    orgName: team?.name,
    orgLogoUrl: team?.logoUrl ?? null,
    role: ctx.role,
    email: profile?.email ?? null,
  });
}
