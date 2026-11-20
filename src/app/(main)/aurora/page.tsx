'use client';
import { useEffect } from 'react';
import { useNavigation } from '@/components/hooks';

export default function AuroraIndex() {
  const { router, renderUrl } = useNavigation();

  useEffect(() => {
    router.replace(renderUrl('/aurora/overview', false));
  }, [router, renderUrl]);

  return null;
}
