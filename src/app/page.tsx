'use client';

import AppLayout from '@/components/app-layout';
import { MonitorPage } from '@/components/monitor/monitor-page';

export default function HomePage() {
  return (
    <AppLayout>
      <MonitorPage />
    </AppLayout>
  );
}
