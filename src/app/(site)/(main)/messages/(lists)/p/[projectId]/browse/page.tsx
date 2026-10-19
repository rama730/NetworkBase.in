import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { notFound } from "next/navigation";

import { BrowseChannels } from "@/components/messages/MessagesViews";
import { isUuid } from "@/lib/validations/uuid";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return buildRouteMetadata({
    title: "Browse channels | NetworkBase", description: "Browse channels in your project.",
    path: isUuid(projectId) ? `/messages/p/${projectId}/browse` : "/messages",
  });
}

export default async function MessagesBrowsePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <BrowseChannels projectId={projectId} />
    </div>
  );
}
