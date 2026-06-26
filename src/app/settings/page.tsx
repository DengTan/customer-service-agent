'use client';

import AppLayout from '@/components/app-layout';
import { SettingsPage } from '@/components/settings/settings-page';

export default function SettingsRoute() {
  return (
    <AppLayout>
      <SettingsPage />
    </AppLayout>
  );
}
