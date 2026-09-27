'use client';

import dynamic from 'next/dynamic';
import { NetworkNotificationsProvider } from '@/components/providers/NetworkNotificationsProvider';
import { MessageAttentionProvider } from '@/components/providers/MessageAttentionProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';

const ChatPopupV2 = dynamic(
  () => import('@/components/chat/v2/ChatPopupV2').then((mod) => mod.ChatPopupV2),
  { ssr: false },
);

const LazyChatProvider = dynamic(
  () => import('@/components/chat/ChatProvider').then((mod) => mod.ChatProvider),
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
          <MessageAttentionProvider>
            {children}
            <ChatPopupV2 />
            <LazyChatProvider presenceEnabled={true} />
          </MessageAttentionProvider>
        </NetworkNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
