import { notFound } from "next/navigation";

import { isChatV3Enabled } from "@/lib/messaging/flag";

// The layout renders the conversation; this route adds no drawer.
export default function ChannelPage() {
  if (!isChatV3Enabled()) notFound();
  return null;
}
