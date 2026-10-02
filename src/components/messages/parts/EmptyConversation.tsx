'use client';

import { MessageSquare } from 'lucide-react';

interface EmptyConversationProps {
    partnerName?: string | null;
}

export function EmptyConversation({ partnerName }: EmptyConversationProps) {
    return (
        <div className="flex flex-1 items-center justify-center p-6">
            <div className="nb-empty-state nb-grid-ground w-full max-w-sm py-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-[8px] border border-border bg-card text-primary shadow-2xs">
                    <MessageSquare className="size-5 text-primary" />
                </div>
                <h3 className="nb-card-title text-foreground">
                    {partnerName ? `Say hi to ${partnerName}` : 'No messages yet'}
                </h3>
                <p className="nb-compact mx-auto mt-1 max-w-[260px] text-muted-foreground">
                    Drop a quick hello below to start the conversation.
                </p>
            </div>
        </div>
    );
}
