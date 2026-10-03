import { Suspense } from "react";

import { DraftsView } from "@/components/messages/MessagesViews";

export default function MessagesDraftsPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={null}>
        <DraftsView />
      </Suspense>
    </div>
  );
}
