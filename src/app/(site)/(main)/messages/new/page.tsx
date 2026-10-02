import { notFound } from "next/navigation";

import { NewMessage } from "@/components/messages/NewMessage";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default function MessagesNewPage() {
  if (!isChatV3Enabled()) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <NewMessage />
    </div>
  );
}
