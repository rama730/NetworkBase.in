import { Suspense } from "react";

import { DetailsScreen } from "@/components/messages/ChannelScreens";

export default async function DetailsPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return (
    <Suspense fallback={null}>
      <DetailsScreen channelId={channelId} />
    </Suspense>
  );
}
