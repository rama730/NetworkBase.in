import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { SearchView } from "@/components/messages/MessagesViews";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "Search messages · NetworkBase", description: "Search every conversation you are in.", path: "/messages/search" });
}

export default function MessagesSearchPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading search" />}>
        <SearchView />
      </Suspense>
    </div>
  );
}
