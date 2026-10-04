import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { SearchView } from "@/components/messages/MessagesViews";

export default function MessagesSearchPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading search" />}>
        <SearchView />
      </Suspense>
    </div>
  );
}
