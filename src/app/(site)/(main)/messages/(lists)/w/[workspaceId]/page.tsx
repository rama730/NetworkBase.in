import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { notFound } from "next/navigation";

import { ProjectLanding } from "@/components/messages/MessagesViews";
import { isUuid } from "@/lib/validations/uuid";

export async function generateMetadata({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: projectId } = await params;
  return buildRouteMetadata({
    title: "Workspace messages | NetworkBase", description: "Conversations for your workspace.",
    path: isUuid(projectId) ? `/messages/w/${projectId}` : "/messages",
  });
}

export default async function MessagesProjectPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: projectId } = await params;
  if (!isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ProjectLanding projectId={projectId} />
    </div>
  );
}
