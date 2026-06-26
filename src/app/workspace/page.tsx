'use client';

import AppLayout from '@/components/app-layout';
import { WorkspacePage } from '@/components/workspace/workspace-page';

export default function WorkspaceRoute() {
  return (
    <AppLayout>
      <WorkspacePage />
    </AppLayout>
  );
}
