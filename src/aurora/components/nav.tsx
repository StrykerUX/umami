'use client';
import { Row, Text } from '@umami/react-zen';
import { useEffect } from 'react';
import { useNavigation } from '@/components/hooks';
import {
  Activity,
  Briefcase,
  Globe,
  Grid2x2,
  LayoutDashboard,
  LayoutGrid,
  LinkIcon,
  Mail,
  Tags,
  Users,
} from '@/components/icons';
import { AuroraLogo } from './AuroraLogo';
import { useAuroraMe } from './hooks';

interface NavLink {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
}

/**
 * Core patch hook for SideNav: Aurora sections first, then the core sections
 * (minus the personal dashboard, which does not exist in a single-org setup).
 */
export function useAuroraNavLinks(coreLinks: NavLink[]): NavLink[] {
  const { data: me } = useAuroraMe();

  if (process.env.cloudMode) {
    return coreLinks;
  }

  const byId = new Map(coreLinks.map(l => [l.id, l]));
  const core = (id: string, fallback: NavLink) => ({ ...fallback, ...(byId.get(id) ?? {}) });

  return [
    { id: 'aurora-overview', label: 'Overview', path: '/aurora/overview', icon: <LayoutGrid /> },
    core('websites', { id: 'websites', label: 'Sitios web', path: '/websites', icon: <Globe /> }),
    { id: 'aurora-sites', label: 'Clasificación', path: '/aurora/sites', icon: <Tags /> },
    { id: 'aurora-clients', label: 'Clientes', path: '/aurora/clients', icon: <Briefcase /> },
    { id: 'aurora-reports', label: 'Reportes', path: '/aurora/reports', icon: <Mail /> },
    { id: 'aurora-uptime', label: 'Uptime', path: '/aurora/uptime', icon: <Activity /> },
    core('boards', { id: 'boards', label: 'Boards', path: '/boards', icon: <LayoutDashboard /> }),
    core('links', { id: 'links', label: 'Links', path: '/links', icon: <LinkIcon /> }),
    core('pixels', { id: 'pixels', label: 'Pixels', path: '/pixels', icon: <Grid2x2 /> }),
    ...(me?.role === 'admin'
      ? [{ id: 'aurora-members', label: 'Miembros', path: '/aurora/members', icon: <Users /> }]
      : []),
  ];
}

/** Paths that only make sense inside the organization context. */
const ORG_PATHS = /^\/(aurora|websites|boards|links|pixels|dashboard)(\/|$)/;

export function getOrgRedirect(pathname: string, search: string, orgId?: string | null) {
  if (!orgId || pathname.startsWith('/teams/')) return null;
  if (pathname === '/' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return `/teams/${orgId}/aurora/overview`;
  }
  if (ORG_PATHS.test(pathname)) {
    return `/teams/${orgId}${pathname}${search ? `?${search}` : ''}`;
  }
  return null;
}

/** Core patch hook for App: keeps everyone inside the single organization. */
export function useAuroraOrgRedirect(enabled: boolean) {
  const { pathname, searchParams, router, teamId } = useNavigation();
  const { data: me } = useAuroraMe(enabled && !process.env.cloudMode);
  const target =
    enabled && !teamId ? getOrgRedirect(pathname, searchParams.toString(), me?.orgId) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return !!target;
}

/** Replaces the team switcher: there is only one organization. */
export function AuroraOrgBadge() {
  const { data: me } = useAuroraMe();

  return (
    <Row alignItems="center" gap="2" paddingX="2" data-test="aurora-org">
      <Text weight="bold">{me?.orgName ?? 'Aurora'}</Text>
    </Row>
  );
}

export function AuroraBrand() {
  return (
    <Row alignItems="center" gap="2">
      <AuroraLogo size={22} />
      <Text weight="bold">Aurora</Text>
    </Row>
  );
}
