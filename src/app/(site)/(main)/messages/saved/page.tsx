import { Suspense } from "react";

import { SavedView } from "@/components/messages/MessagesViews";

export default function MessagesSavedPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={null}>
        <SavedView />
      </Suspense>
    </div>
  );
}
