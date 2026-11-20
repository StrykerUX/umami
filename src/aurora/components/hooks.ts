'use client';
import { useApi } from '@/components/hooks/useApi';
import { useModified } from '@/components/hooks/useModified';
import type { AuroraRole } from '../lib/constants';

export interface AuroraMe {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  role: AuroraRole;
  email: string | null;
}

export function useAuroraMe(enabled = true) {
  const { get, useQuery } = useApi();

  return useQuery<AuroraMe>({
    queryKey: ['aurora', 'me'],
    queryFn: () => get('/aurora/me'),
    enabled,
    staleTime: 60000,
  });
}

/** GET an Aurora endpoint. Refetches when `touchAurora(key)` is called. */
export function useAuroraQuery<T = any>(
  key: string,
  path: string,
  params: object = {},
  enabled = true,
) {
  const { get, useQuery } = useApi();
  const { modified } = useModified(`aurora:${key}`);

  return useQuery<T>({
    queryKey: ['aurora', key, path, params, { modified }],
    queryFn: () => get(path, params),
    enabled,
  });
}

export function useAuroraActions() {
  const { post, put, patch, del } = useApi();
  const { touch } = useModified();

  return {
    post,
    put,
    patch,
    del,
    refresh: (...keys: string[]) => {
      for (const k of keys) touch(`aurora:${k}`);
    },
  };
}

export function canEdit(role?: AuroraRole) {
  return role === 'admin' || role === 'editor';
}
