import { NewMessage } from "@/components/messages/NewMessage";

export default function MessagesNewPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <NewMessage />
    </div>
  );
}
