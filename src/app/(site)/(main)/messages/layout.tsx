import { MessagesChrome } from "@/components/messages/MessagesChrome";

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-messages-surface className="relative h-full min-h-0">
      {children}
      <MessagesChrome />
    </div>
  );
}
