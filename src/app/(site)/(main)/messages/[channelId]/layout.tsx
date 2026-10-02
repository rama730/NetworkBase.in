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
    <div data-scroll-root="route" className="relative h-full min-h-0 overflow-hidden">
      <Suspense fallback={<div role="status" aria-label="Loading conversation" className="h-full bg-card" />}>
        <ChannelScreen channelId={channelId} />
      </Suspense>
      {children}
    </div>
  );
}
