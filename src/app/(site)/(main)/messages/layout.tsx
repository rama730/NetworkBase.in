import { MessagesChrome } from "@/components/messages/MessagesChrome";
import { isChatV3Enabled } from "@/lib/messaging/flag";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  if (!isChatV3Enabled()) return children;
  return (
    <div data-messages-surface className="relative h-full min-h-0">
      {children}
      <MessagesChrome />
    </div>
  );
}
