'use client';

import dynamic from 'next/dynamic';
import { ChatShellProvider } from '@/components/messages/ChatShellProvider';
import { NetworkNotificationsProvider } from '@/components/providers/NetworkNotificationsProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';

// The floating chat button and window (report 7.13).
const ChatLauncher = dynamic(() => import('@/components/messages/ChatLauncher'), { ssr: false });

const LazyPresenceProvider = dynamic(
  () => import('@/components/providers/PresenceProvider').then((mod) => mod.PresenceProvider),
  { ssr: false },
);

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
          </ChatShellProvider>
        </NetworkNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
