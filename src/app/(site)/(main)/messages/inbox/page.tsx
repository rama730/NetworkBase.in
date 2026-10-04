import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { InboxView } from "@/components/messages/MessagesViews";

export default function MessagesInboxPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading Inbox" />}>
        <InboxView />
      </Suspense>
    </div>
  );
}
