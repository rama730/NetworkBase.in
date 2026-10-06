import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Something didn't load: one look and one phrase everywhere in Messages (spec: a persistent
 * red-soft notice with Retry). `what` reads "Pins" → "Pins couldn't load."
 */
export function ErrorNotice({ what, onRetry, className }: { what: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-[var(--status-danger)]", className)}>
      <span className="min-w-0 flex-1">{what} couldn&apos;t load.</span>
      {onRetry ? <Button type="button" variant="outline" size="sm" onClick={onRetry} className="pointer-coarse:h-11">Retry</Button> : null}
    </div>
  );
}
