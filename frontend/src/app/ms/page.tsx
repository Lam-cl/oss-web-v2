'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function MSRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const promoterID = searchParams.get('promoterID');
    if (!promoterID) {
      router.replace('/');
      return;
    }
    const parts = promoterID.split('-');
    const prefix = parts[0]?.toUpperCase() || 'TWE';
    const code = parts[1] || '';
    router.replace(`/sim/purchase?promoter=${prefix}&code=${code}`);
  }, [searchParams, router]);

  return null;
}

export default function MSPage() {
  return (
    <Suspense>
      <MSRedirect />
    </Suspense>
  );
}
