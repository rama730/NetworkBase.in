import { ListSkeleton } from "@/components/messages/ListSkeleton";

// Shown in the content pane while a Messages route loads; the chat sidebar (layout) stays.
export default function MessagesLoading() {
  return <ListSkeleton label="Loading messages" />;
}
