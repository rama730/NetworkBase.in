import { ThreadsView } from "@/components/messages/MessagesViews";

export default function MessagesThreadsPage() {
  return (
    <div data-scroll-root="route" className="h-full min-h-0 overflow-hidden">
      <ThreadsView />
    </div>
  );
}
