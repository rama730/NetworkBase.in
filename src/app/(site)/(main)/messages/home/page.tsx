import { notFound } from "next/navigation";

import { HomeScreen } from "@/components/messages/HomeScreen";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default function MessagesHomePage() {
  if (!isChatV3Enabled()) notFound();
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <HomeScreen />
    </div>
  );
}
