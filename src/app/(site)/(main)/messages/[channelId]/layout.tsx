import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ChannelScreen } from "@/components/messages/ChannelScreens";
import { isUuid } from "@/lib/validations/uuid";

// ponytail: channel URLs use ids, no slugs (L-9). upgrade: vanity URLs if requested.
/** The conversation stays mounted while thread and details routes open over it. */
export default async function ChannelLayout({ children, params }: { children: React.ReactNode; params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  if (!isUuid(channelId)) notFound();
  return (
    <div data-scroll-root="route" className="relative flex h-full min-h-0 w-full overflow-hidden">
      <div className="flex-1 min-w-0 h-full">
        <Suspense fallback={<div role="status" aria-label="Loading conversation" className="h-full bg-card" />}>
          <ChannelScreen channelId={channelId} />
        </Suspense>
      </div>
      {children}
    </div>
  );
}
