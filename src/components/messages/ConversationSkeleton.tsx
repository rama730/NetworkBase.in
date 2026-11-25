import { MessageHistory } from "@/components/messages/MessageHistory";

/** Message rows loading, anchored to the bottom like the real timeline: square soft blocks that breathe (the mix). */
const Sk = ({ className = "", style }: { className?: string; style?: React.CSSProperties }) => <span aria-hidden="true" className={`nbm-sk ${className}`} style={style} />;
export function TimelineSkeleton({ variant = "conversation" }: { variant?: "conversation" | "thread" } = {}) {
  return (
    <MessageHistory variant={variant} role="status" className="flex flex-col justify-end gap-5 overflow-hidden p-4">
      <span className="sr-only">{variant === "thread" ? "Loading replies…" : "Loading messages…"}</span>
      {[64, 80, 48, 72, 56].map((width, row) => (
        <div key={row} className="flex gap-2.5">
          <Sk className="size-[34px] flex-none" />
          <div className="flex-1 space-y-2 pt-1">
            <Sk className="h-[9px] w-28" />
            <Sk className="h-[9px]" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </MessageHistory>
  );
}

function ComposerSkeleton() {
  return <div className="nb-message-composer border-t border-border bg-card px-3 pt-2 sm:px-4"><Sk className="h-[86px]" /></div>;
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
      <div className="flex h-16 flex-none items-center gap-2 border-b border-border px-2 sm:px-3">
        {header}
        <Sk className="ml-2 h-5 w-40" />
      </div>
      {tabs ? (
        <div className="flex h-[38px] flex-none items-end gap-4 border-b border-border px-4 pb-3">
          <Sk className="h-[9px] w-16" />
          <Sk className="h-[9px] w-12" />
        </div>
      ) : null}
      <TimelineSkeleton />
      <ComposerSkeleton />
    </div>
  );
}
