import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { notFound } from "next/navigation";

import { BrowseChannels } from "@/components/messages/MessagesViews";
import { isUuid } from "@/lib/validations/uuid";

export async function generateMetadata({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: projectId } = await params;
  return buildRouteMetadata({
    title: "Browse channels · NetworkBase", description: "Browse channels in your workspace.",
    path: isUuid(projectId) ? `/messages/w/${projectId}/browse` : "/messages",
  });
}

export default async function MessagesBrowsePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: projectId } = await params;
  if (!isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <BrowseChannels projectId={projectId} />
    </div>
  );
}
