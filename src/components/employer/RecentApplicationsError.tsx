'use client';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export function RecentApplicationsError({ message, retryLabel }: { message: string; retryLabel: string }) {
  const router = useRouter();

  return (
    <div role="alert" className="space-y-3 p-5">
      <p className="text-base text-foreground">{message}</p>
      <Button type="button" size="lg" className="min-h-12" onClick={() => router.refresh()}>
        {retryLabel}
      </Button>
    </div>
  );
}
