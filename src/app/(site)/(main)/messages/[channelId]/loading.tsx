import { ConversationSkeleton } from "@/components/messages/ConversationSkeleton";

// Opening a conversation shows a conversation loading (never the list screens' skeleton, which
// lives in the (lists) route group).
export default function ConversationLoading() {
  return <ConversationSkeleton />;
}
