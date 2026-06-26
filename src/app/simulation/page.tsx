'use client';

import AppLayout from '@/components/app-layout';
import { SimulationPage } from '@/components/simulation/simulation-page';

export default function SimulationPageEntry() {
  return (
    <AppLayout>
      <SimulationPage />
    </AppLayout>
  );
}
