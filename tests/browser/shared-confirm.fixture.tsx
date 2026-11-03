import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { WorkspaceLinksManager } from '@/components/workspaces/dashboard/WorkspaceSocialLinksCard';
import { SharedConfirmHost } from '@/components/ui/SharedConfirmHost';
import { confirmFileNavigation } from '@/lib/files/unsaved-navigation';
import { useFilesStore } from '@/stores/filesStore';

// The shared dialog in place of browser pop-ups (report §32.3, decision 75): the links editor closing with unsaved
// links, and file navigation asking through the one SharedConfirmHost.

function Links() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p data-testid="links-state">{open ? 'open' : 'closed'}</p>
      <WorkspaceLinksManager projectId="p1" links={[{ id: 'l1', platform: 'website', url: 'https://example.com', label: 'Site', order: 0 }]} mode="dialog" open={open} onOpenChange={setOpen} />
    </>
  );
}

function Files() {
  const [went, setWent] = useState(0);
  return (
    <>
      <button type="button" onClick={() => { useFilesStore.getState().ensureProjectFilesState('p1'); useFilesStore.getState().setDirtyFile('p1', 'n1', true); }}>Make unsaved</button>
      <button type="button" onClick={() => confirmFileNavigation('p1', () => setWent((n) => n + 1))}>Go to another tab</button>
      <p data-testid="went">{went}</p>
      <SharedConfirmHost />
    </>
  );
}

createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('view') === 'files' ? <Files /> : <Links />);
