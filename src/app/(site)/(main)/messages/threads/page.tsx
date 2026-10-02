import { notFound } from "next/navigation";

import { ThreadsView } from "@/components/messages/MessagesViews";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default function MessagesThreadsPage() {
  if (!isChatV3Enabled()) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ThreadsView />
    </div>
  );
}
