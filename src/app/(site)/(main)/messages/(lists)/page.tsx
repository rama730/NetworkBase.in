import { redirect } from 'next/navigation';
import { findDm } from '@/app/actions/chat/members';
import { MessagesIndex } from '@/components/messages/MessagesIndex';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { conversationHref } from '@/lib/messaging/routes';

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Messages · NetworkBase',
        description: 'Channels and direct messages for your workspaces.',
        path: '/messages',
    });
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const params = await searchParams;
    // "Message" buttons link to /messages?userId=.
    const targetUserId = typeof params.userId === 'string' ? params.userId : typeof params.user === 'string' ? params.user : null;
    let dmError: string | null = null;
    let dmIntent: { userId: string; displayName: string | null } | null = null;
    if (targetUserId) {
        // Rendering never creates or reopens a conversation: an existing DM is a plain redirect,
        // otherwise the page asks the person to start it (a POST from the button).
        const found = await findDm({ userId: targetUserId });
        if (found.success && found.channelId) redirect(conversationHref(found.channelId));
        if (found.success) dmIntent = { userId: targetUserId, displayName: found.displayName };
        else dmError = found.error ?? 'chat_dm_not_allowed';
    }
    return (
        <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
            <MessagesIndex dmError={dmError} dmIntent={dmIntent} />
        </div>
    );
}
