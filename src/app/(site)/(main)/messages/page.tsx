import { redirect } from 'next/navigation';
import { getOrCreateDm } from '@/app/actions/chat/members';
import { MessagesIndex } from '@/components/messages/MessagesIndex';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Messages | NetworkBase',
        description: 'Channels and direct messages for your projects.',
        path: '/messages',
    });
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const params = await searchParams;
    // "Message" buttons link to /messages?userId=.
    const targetUserId = typeof params.userId === 'string' ? params.userId : typeof params.user === 'string' ? params.user : null;
    if (targetUserId) {
        const dm = await getOrCreateDm({ userId: targetUserId });
        if (dm.success) redirect(`/messages/${dm.channelId}`);
    }
    return (
        <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
            <MessagesIndex />
        </div>
    );
}
