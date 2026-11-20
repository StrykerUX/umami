import { auroraRequest, json } from '@/aurora/lib/api';
import { teamRoleToAuroraRole } from '@/aurora/lib/org';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  const { ctx, error } = await auroraRequest(request, undefined, 'admin');

  if (error) {
    return error;
  }

  const members = await prisma.client.teamUser.findMany({
    where: { teamId: ctx.orgId, user: { deletedAt: null } },
    include: {
      user: {
        select: { id: true, username: true, displayName: true, role: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const profiles = await prisma.client.auroraUserProfile.findMany({
    where: { userId: { in: members.map(m => m.userId) } },
  });
  const emails = new Map(profiles.map(p => [p.userId, p.email]));

  return json({
    data: members.map(m => ({
      userId: m.userId,
      username: m.user.username,
      displayName: m.user.displayName,
      email: emails.get(m.userId) ?? null,
      role: teamRoleToAuroraRole(m.user.role, m.role),
      isOwner: m.role === 'team-owner',
      joinedAt: m.createdAt,
    })),
  });
}
