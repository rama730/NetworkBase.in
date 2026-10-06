import { NewMessage } from "@/components/messages/NewMessage";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "New message | NetworkBase", description: "Start a conversation or a group chat.", path: "/messages/new" });
}

export default function MessagesNewPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <NewMessage />
    </div>
  );
}
