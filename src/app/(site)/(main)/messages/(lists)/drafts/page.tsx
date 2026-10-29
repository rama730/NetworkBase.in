import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { DraftsView } from "@/components/messages/MessagesViews";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "Drafts and scheduled · NetworkBase", description: "Unsent drafts and scheduled messages.", path: "/messages/drafts" });
}

export default function MessagesDraftsPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading drafts" />}>
        <DraftsView />
      </Suspense>
    </div>
  );
}
