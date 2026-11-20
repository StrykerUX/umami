/**
 * Core patch hook: entities created without a team go to the organization.
 * Kept free of static DB imports so core route modules stay cheap to import (and testable).
 */
export async function resolveCreateTeamId(teamId?: string | null): Promise<string | undefined> {
  if (
    teamId ||
    process.env.AURORA_DISABLE_ORG === '1' ||
    process.env.CLOUD_MODE ||
    !process.env.DATABASE_URL
  ) {
    return teamId ?? undefined;
  }

  try {
    const { getOrgId } = await import('./org');
    return await getOrgId();
  } catch {
    return undefined;
  }
}
