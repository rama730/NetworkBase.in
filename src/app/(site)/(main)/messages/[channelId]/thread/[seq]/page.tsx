import { notFound } from "next/navigation";

import { ThreadScreen } from "@/components/messages/ChannelScreens";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default async function ThreadPage({ params }: { params: Promise<{ channelId: string; seq: string }> }) {
  const { channelId, seq } = await params;
  const rootSeq = Number(seq);
  if (!isChatV3Enabled() || !Number.isInteger(rootSeq) || rootSeq < 1) notFound();
  return <ThreadScreen channelId={channelId} rootSeq={rootSeq} />;
}
