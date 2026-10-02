import { notFound } from "next/navigation";

import { ActivityView } from "@/components/messages/MessagesViews";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default function MessagesActivityPage() {
  if (!isChatV3Enabled()) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ActivityView />
    </div>
  );
}
