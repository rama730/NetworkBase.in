/** A conversation loading: its header bar and a few message rows (not a list or a blank card). */
export function TimelineSkeleton() {
  return (
    <div role="status" className="flex-1 space-y-5 overflow-hidden p-4">
      <span className="sr-only">Loading messages…</span>
      {[64, 80, 48, 72, 56].map((width, row) => (
        <div key={row} className="flex animate-pulse gap-2.5">
          <div className="size-[34px] flex-none rounded-[5px] bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 rounded bg-muted" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-14 flex-none animate-pulse items-center gap-2 border-b border-border px-4">
        <div className="h-4 w-40 rounded bg-muted" />
      </div>
      <TimelineSkeleton />
    </div>
  );
}
