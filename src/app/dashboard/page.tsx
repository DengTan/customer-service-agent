'use client';

import AppLayout from '@/components/app-layout';
import { DashboardPage } from '@/components/dashboard/dashboard-page';

export default function DashboardRoute() {
  return (
    <AppLayout>
      <DashboardPage />
    </AppLayout>
  );
}
