import { Suspense } from "react";

import { ListSkeleton } from "@/components/messages/ListSkeleton";
import { InboxView } from "@/components/messages/MessagesViews";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "Inbox · NetworkBase", description: "Mentions, thread replies and reactions.", path: "/messages/inbox" });
}

export default function MessagesInboxPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<ListSkeleton label="Loading inbox" />}>
        <InboxView />
      </Suspense>
    </div>
  );
}
