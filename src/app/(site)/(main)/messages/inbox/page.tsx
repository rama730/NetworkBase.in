import { Suspense } from "react";

import { InboxView } from "@/components/messages/MessagesViews";

export default function MessagesInboxPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={null}>
        <InboxView />
      </Suspense>
    </div>
  );
}
