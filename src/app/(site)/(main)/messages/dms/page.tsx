import { DmList } from "@/components/messages/MessagesViews";

export default function MessagesDmsPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <DmList />
    </div>
  );
}
