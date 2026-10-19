import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { notFound } from "next/navigation";

import { ProjectLanding } from "@/components/messages/MessagesViews";
import { isUuid } from "@/lib/validations/uuid";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return buildRouteMetadata({
    title: "Project messages | NetworkBase", description: "Conversations for your project.",
    path: isUuid(projectId) ? `/messages/p/${projectId}` : "/messages",
  });
}

export default async function MessagesProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ProjectLanding projectId={projectId} />
    </div>
  );
}
