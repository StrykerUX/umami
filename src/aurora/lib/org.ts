import { ROLES } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import { getRandomChars } from '@/lib/generate';
import prisma from '@/lib/prisma';
import {
  AURORA_ROLE_MAP,
  type AuroraRole,
  getAuroraOrgName,
  SETTING_ORG_ID,
  SETTING_PERSONAL_MIGRATED,
} from './constants';

async function getSetting(key: string) {
  return (await prisma.client.appSetting.findUnique({ where: { key } }))?.value ?? null;
}

async function setSetting(key: string, value: string) {
  await prisma.client.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

/** Returns the single organization team id, creating it on first use. */
export async function getOrgId(): Promise<string> {
  const existing = await getSetting(SETTING_ORG_ID);

  if (existing) {
    const team = await prisma.client.team.findFirst({ where: { id: existing, deletedAt: null } });

    if (team) {
      return team.id;
    }
  }

  const owner = await prisma.client.user.findFirst({
    where: { role: ROLES.admin, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  if (!owner) {
    throw new Error('Aurora: no admin user exists to own the organization.');
  }

  const id = uuid();

  await prisma.client.team.create({
    data: {
      id,
      name: getAuroraOrgName(),
      accessCode: `team_${getRandomChars(16)}`,
      members: { create: { id: uuid(), userId: owner.id, role: ROLES.teamOwner } },
    },
  });

  await setSetting(SETTING_ORG_ID, id);

  return id;
}

export function teamRoleToAuroraRole(userRole: string, teamRole?: string | null): AuroraRole {
  if (userRole === ROLES.admin) {
    return 'admin';
  }

  if (teamRole === ROLES.teamOwner || teamRole === ROLES.teamManager) {
    return 'admin';
  }

  if (teamRole === ROLES.teamMember || (!teamRole && userRole === ROLES.user)) {
    return 'editor';
  }

  return 'viewer';
}

function defaultTeamRoleFor(userRole: string) {
  if (userRole === ROLES.admin) return ROLES.teamManager;
  if (userRole === ROLES.user) return ROLES.teamMember;
  return ROLES.teamViewOnly;
}

/**
 * Ensures the user belongs to the organization (users created outside the invite
 * flow join automatically with a role derived from their global role).
 */
export async function ensureMembership(user: { id: string; role: string }, orgId?: string) {
  const teamId = orgId ?? (await getOrgId());
  let member = await prisma.client.teamUser.findFirst({ where: { teamId, userId: user.id } });

  if (!member) {
    member = await prisma.client.teamUser.create({
      data: { id: uuid(), teamId, userId: user.id, role: defaultTeamRoleFor(user.role) },
    });
  }

  return {
    orgId: teamId,
    teamRole: member.role,
    role: teamRoleToAuroraRole(user.role, member.role),
  };
}

/** Applies an Aurora role to a user: global role + org team role. */
export async function setMemberRole(userId: string, role: AuroraRole, orgId?: string) {
  const teamId = orgId ?? (await getOrgId());
  const { userRole, teamRole } = AURORA_ROLE_MAP[role];
  const member = await prisma.client.teamUser.findFirst({ where: { teamId, userId } });

  await prisma.client.$transaction([
    prisma.client.user.update({ where: { id: userId }, data: { role: userRole } }),
    member
      ? prisma.client.teamUser.update({
          where: { id: member.id },
          // Never demote the org owner's team role.
          data: { role: member.role === ROLES.teamOwner ? ROLES.teamOwner : teamRole },
        })
      : prisma.client.teamUser.create({ data: { id: uuid(), teamId, userId, role: teamRole } }),
  ]);
}

/**
 * Moves personally owned websites, links, pixels and boards into the organization.
 * Runs once (tracked by an app setting) unless `force` is set.
 */
export async function migratePersonalToOrg(options: { force?: boolean } = {}) {
  if (!options.force && (await getSetting(SETTING_PERSONAL_MIGRATED))) {
    return { websites: 0, links: 0, pixels: 0, boards: 0, skipped: true };
  }

  const teamId = await getOrgId();
  const where = { userId: { not: null }, teamId: null } as const;
  const data = { userId: null, teamId };

  const [websites, links, pixels, boards] = await prisma.client.$transaction([
    prisma.client.website.updateMany({ where, data }),
    prisma.client.link.updateMany({ where, data }),
    prisma.client.pixel.updateMany({ where, data }),
    prisma.client.board.updateMany({ where, data }),
  ]);

  await setSetting(SETTING_PERSONAL_MIGRATED, new Date().toISOString());

  return {
    websites: websites.count,
    links: links.count,
    pixels: pixels.count,
    boards: boards.count,
    skipped: false,
  };
}

/** All non-deleted websites of the organization. */
export async function getOrgWebsites(orgId?: string) {
  const teamId = orgId ?? (await getOrgId());

  return prisma.client.website.findMany({
    where: { teamId, deletedAt: null },
    select: { id: true, name: true, domain: true, createdAt: true },
    orderBy: { name: 'asc' },
  });
}
