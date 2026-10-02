import { notFound } from "next/navigation";

import { ThreadScreen } from "@/components/messages/ChannelScreens";

export default async function ThreadPage({ params }: { params: Promise<{ channelId: string; seq: string }> }) {
  const { channelId, seq } = await params;
  const rootSeq = Number(seq);
  if (!Number.isInteger(rootSeq) || rootSeq < 1) notFound();
  return <ThreadScreen channelId={channelId} rootSeq={rootSeq} />;
}
