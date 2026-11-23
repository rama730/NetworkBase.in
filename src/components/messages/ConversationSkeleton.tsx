import { Skeleton } from "@/components/ui/skeleton";
import { MessageHistory } from "@/components/messages/MessageHistory";

/** Message rows loading, anchored to the bottom like the real timeline (shared shimmer, no pulse). */
export function TimelineSkeleton({ variant = "conversation" }: { variant?: "conversation" | "thread" } = {}) {
  return (
    <MessageHistory variant={variant} role="status" className="flex flex-col justify-end gap-5 overflow-hidden p-4">
      <span className="sr-only">{variant === "thread" ? "Loading replies…" : "Loading messages…"}</span>
      {[64, 80, 48, 72, 56].map((width, row) => (
        <div key={row} className="flex gap-2.5">
          <Skeleton kind="tile" className="size-[34px] flex-none rounded-md" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-28 rounded-sm" />
            <Skeleton className="h-3 rounded-sm" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </MessageHistory>
  );
}

function ComposerSkeleton() {
  return <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><Skeleton className="h-[86px] rounded-md" /></div>;
}

/** The drawer already owns its header while the thread's code downloads. */
export function ThreadSkeleton() {
  return <div className="flex h-full min-h-0 flex-col bg-card"><TimelineSkeleton variant="thread" /><ComposerSkeleton /></div>;
}

/**
 * A conversation loading: header, tab bar, rows and the composer box, so nothing moves when it lands.
 * `header` keeps Back (and the window's controls) usable while it loads.
 */
export function ConversationSkeleton({ header, tabs = true }: { header?: React.ReactNode; tabs?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-14 flex-none items-center gap-2 border-b border-border px-2 sm:px-3">
        {header}
        <Skeleton className="ml-2 h-4 w-40 rounded-sm" />
      </div>
      {tabs ? (
        <div className="flex h-10 flex-none items-end gap-4 border-b border-border px-4 pb-2">
          <Skeleton className="h-3 w-16 rounded-sm" />
          <Skeleton className="h-3 w-12 rounded-sm" />
        </div>
      ) : null}
      <TimelineSkeleton />
      <ComposerSkeleton />
    </div>
  );
}
