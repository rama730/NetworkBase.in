'use client';

import dynamic from 'next/dynamic';
import { NetworkNotificationsProvider } from '@/components/providers/NetworkNotificationsProvider';
import { MessageAttentionProvider } from '@/components/providers/MessageAttentionProvider';
import { RealtimeProvider } from '@/components/providers/RealtimeProvider';
import { ChatShellProvider } from '@/components/messages/ChatShellProvider';
import { isChatV3Enabled } from '@/lib/messaging/flag';

const CHAT_V3 = isChatV3Enabled();
// Chat v3 owns the Messages badge; the old provider stays until cutover.
const AttentionProvider = CHAT_V3 ? ChatShellProvider : MessageAttentionProvider;

const ChatPopupV2 = dynamic(
  () => import('@/components/chat/v2/ChatPopupV2').then((mod) => mod.ChatPopupV2),
  { ssr: false },
);

// Chat v3 replaces the old popup with the launcher (report 7.13).
const ChatLauncher = dynamic(() => import('@/components/messages/ChatLauncher'), { ssr: false });

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
          <AttentionProvider>
            {children}
            {CHAT_V3 ? <ChatLauncher /> : <ChatPopupV2 />}
            <LazyChatProvider presenceEnabled={true} />
          </AttentionProvider>
        </NetworkNotificationsProvider>
      </RealtimeProvider>
    </>
  );
}
