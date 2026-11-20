import { ROLES } from '@/lib/constants';

export const AURORA_ROLES = ['admin', 'editor', 'viewer'] as const;
export type AuroraRole = (typeof AURORA_ROLES)[number];

export const AURORA_ROLE_RANK: Record<AuroraRole, number> = { viewer: 0, editor: 1, admin: 2 };

/** Umami user role + org team role for each Aurora role. */
export const AURORA_ROLE_MAP: Record<AuroraRole, { userRole: string; teamRole: string }> = {
  admin: { userRole: ROLES.admin, teamRole: ROLES.teamManager },
  editor: { userRole: ROLES.user, teamRole: ROLES.teamMember },
  viewer: { userRole: ROLES.viewOnly, teamRole: ROLES.teamViewOnly },
};

export const REPORT_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'bimonthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

export const REPORT_SCOPES = ['all', 'workspace', 'client', 'website'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];

export const WORKSPACE_KINDS = ['internal', 'external'] as const;

export const DEFAULT_REPORT_SECTIONS = {
  kpis: true,
  topPages: true,
  referrers: true,
  countries: true,
  uptime: true,
};
export type ReportSections = typeof DEFAULT_REPORT_SECTIONS;

export const SETTING_ORG_ID = 'aurora.orgId';
export const SETTING_PERSONAL_MIGRATED = 'aurora.personalMigrated';

export const INVITE_DEFAULT_TTL_DAYS = 7;
export const RESET_TTL_MINUTES = 60;
export const REPORT_LINK_TTL_DAYS = 120;
export const REPORT_SEND_HOUR = 8;
export const DEFAULT_TIMEZONE = 'America/Mexico_City';

/** Consecutive failed checks before a monitor is considered down. */
export const UPTIME_FAILURE_THRESHOLD = 2;
export const UPTIME_RETENTION_DAYS = 90;

export function getAuroraOrgName() {
  return process.env.AURORA_ORG_NAME || 'Aurora';
}

export function getAppUrl() {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
