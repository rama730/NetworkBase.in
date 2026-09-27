import { InboxListSkeletonV2, ThreadSkeletonV2 } from "@/components/chat/v2/MessagesSurfaceSkeletons";

export default function MessagesLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading messages" className="grid h-full min-h-0 grid-cols-[minmax(18rem,30%)_1fr]">
      <span className="sr-only">Loading messages…</span>
      <InboxListSkeletonV2 surface="page" />
      <ThreadSkeletonV2 surface="page" />
    </div>
  );
}
