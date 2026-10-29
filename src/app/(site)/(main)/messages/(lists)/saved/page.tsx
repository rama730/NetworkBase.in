import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { SavedView } from "@/components/messages/MessagesViews";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "Saved · NetworkBase", description: "Messages you saved, with reminders.", path: "/messages/saved" });
}

export default function MessagesSavedPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading saved messages" />}>
        <SavedView />
      </Suspense>
    </div>
  );
}
