import { ActivityView } from "@/components/messages/MessagesViews";

export default function MessagesActivityPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ActivityView />
    </div>
  );
}
