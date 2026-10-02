import { notFound } from "next/navigation";

import { BrowseChannels } from "@/components/messages/MessagesViews";
import { isChatV3Enabled } from "@/lib/messaging/flag";
import { isUuid } from "@/lib/validations/uuid";

export default async function MessagesBrowsePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isChatV3Enabled() || !isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <BrowseChannels projectId={projectId} />
    </div>
  );
}
