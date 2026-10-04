'use client';

import dynamic from 'next/dynamic';
import { ChatShellProvider } from '@/components/messages/ChatShellProvider';
import { NetworkNotificationsProvider } from '@/components/providers/NetworkNotificationsProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';
import { usePresenceUi } from '@/components/presence/presence-ui-store';

// The floating chat button and window (report 7.13).
const ChatLauncher = dynamic(() => import('@/components/messages/ChatLauncher'), { ssr: false });

const LazyPresenceProvider = dynamic(
  () => import('@/components/providers/PresenceProvider').then((mod) => mod.PresenceProvider),
  { ssr: false },
);

// "Set a status" loads only when someone opens it.
const StatusPicker = dynamic(() => import('@/components/presence/StatusPicker').then((mod) => mod.StatusPicker), { ssr: false });

function StatusPickerHost() {
  const open = usePresenceUi((state) => state.pickerOpen);
  return open ? <StatusPicker /> : null;
}

interface MainRuntimeProvidersProps {
  children: React.ReactNode;
}

export function MainRuntimeProviders({
  children,
}: MainRuntimeProvidersProps) {
  return (
    <>
      <RealtimeProvider>
        <NetworkNotificationsProvider>
          <ChatShellProvider>
            {children}
            <ChatLauncher />
            <LazyPresenceProvider presenceEnabled={true} />
            <StatusPickerHost />
          </ChatShellProvider>
        </NetworkNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
