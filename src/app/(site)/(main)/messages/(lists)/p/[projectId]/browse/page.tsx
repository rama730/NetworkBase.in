import { notFound } from "next/navigation";

import { BrowseChannels } from "@/components/messages/MessagesViews";
import { isUuid } from "@/lib/validations/uuid";

export default async function MessagesBrowsePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <BrowseChannels projectId={projectId} />
    </div>
  );
}
