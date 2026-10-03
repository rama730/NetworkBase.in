import { Suspense } from "react";

import { SearchView } from "@/components/messages/MessagesViews";

export default function MessagesSearchPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={null}>
        <SearchView />
      </Suspense>
    </div>
  );
}
