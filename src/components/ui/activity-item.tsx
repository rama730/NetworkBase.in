import Link from "next/link";
import { BookOpenText, CheckCircle2, ClipboardCheck, FilePlus2, FolderKanban, GitBranch, IterationCcw, ListTodo, Megaphone, UserRoundPlus, type LucideIcon } from "lucide-react";

import { activityIcon } from "@/lib/organizations/activity-rules";
import { formatDistanceToNow } from "@/lib/utils/date";

const ICONS: Record<string, LucideIcon> = { BookOpenText, CheckCircle2, ClipboardCheck, FilePlus2, FolderKanban, GitBranch, IterationCcw, ListTodo, Megaphone, UserRoundPlus };

/** One activity row (report §5.3): icon, one or two lines, and the real time underneath in small mono. */
export function ActivityItem({ kind, text, href, at }: { kind: string; text: string; href: string; at: string }) {
  const Icon = ICONS[activityIcon(kind)] ?? ListTodo;
  return (
    <li className="flex min-w-0 items-start gap-2.5">
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <Link href={href} className="line-clamp-2 break-words leading-5 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{text}</Link>
        <time dateTime={at} className="mt-0.5 block font-mono text-xs text-muted-foreground">{formatDistanceToNow(new Date(at), { addSuffix: true })}</time>
      </div>
    </li>
  );
}
