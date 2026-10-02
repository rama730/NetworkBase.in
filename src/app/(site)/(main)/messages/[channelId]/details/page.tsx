import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DetailsScreen } from "@/components/messages/ChannelScreens";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default async function DetailsPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  if (!isChatV3Enabled()) notFound();
  return (
    <Suspense fallback={null}>
      <DetailsScreen channelId={channelId} />
    </Suspense>
  );
}
