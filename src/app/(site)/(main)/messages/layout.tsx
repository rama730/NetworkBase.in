import { buildRouteMetadata } from "@/lib/metadata/route-metadata";
import { MessagesChrome } from "@/components/messages/MessagesChrome";
import { MessagesSidebar } from "@/components/messages/MessagesSidebar";

export const metadata = buildRouteMetadata({
  title: "Messages · NetworkBase",
  description: "Channels and direct messages for your workspaces.",
  path: "/messages",
  robots: { index: false, follow: false },
});

/** App navigation (from MainLayout) → chat sidebar → conversation. */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-messages-surface className="nbm flex h-full min-h-0">
      <MessagesSidebar />
      <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
      <MessagesChrome />
    </div>
  );
}
