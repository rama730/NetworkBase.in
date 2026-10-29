import { NewMessage } from "@/components/messages/NewMessage";
import { buildRouteMetadata } from "@/lib/metadata/route-metadata";

export function generateMetadata() {
  return buildRouteMetadata({ title: "New message | NetworkBase", description: "Start a direct message or a group message.", path: "/messages/new" });
}

export default function MessagesNewPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <NewMessage />
    </div>
  );
}
