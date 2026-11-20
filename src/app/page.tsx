'use client';
import { getClientAuthToken } from '@/lib/client';
import { LAST_TEAM_CONFIG } from '@/lib/constants';
import { getItem } from '@/lib/storage';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const lastTeam = getItem(LAST_TEAM_CONFIG);
    // AURORA: land on the Aurora overview (core landing page in cloud mode).
    const AURORA_HOME = process.env.cloudMode ? 'websites' : 'aurora/overview';

    // Without a token we already know the user is logged out; skip the /websites.
    if (!process.env.cloudMode && !getClientAuthToken()) {
      router.replace('/login');
    } else if (lastTeam) {
      router.replace(`/teams/${lastTeam}/${AURORA_HOME}`);
    } else {
      router.replace(`/${AURORA_HOME}`); // AURORA: App moves this into the organization
    }
  }, [router]);

  return null;
}
