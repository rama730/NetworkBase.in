import { FileText, Hash, Lock, Users, type LucideProps } from "lucide-react";

export type ConversationKind = { kind: string; name: string | null; application_id?: string | null };

/** One icon rule for a non-DM conversation (sidebar, Home, quick switcher, header). DMs show the person. */
export function ConversationIcon({ channel, ...props }: { channel: ConversationKind } & LucideProps) {
  if (channel.application_id) return <FileText {...props} />;
  if (channel.name === null) return <Users {...props} />;
  return channel.kind === "private" ? <Lock {...props} /> : <Hash {...props} />;
}
