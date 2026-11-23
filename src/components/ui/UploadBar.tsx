import { cn } from "@/lib/utils";

/** How far an upload is: one slim square bar in the brand colour, optionally with its percent in mono. */
export function UploadBar({ value, max = 100, label, showPercent = false, className }: { value: number; max?: number; label: string; showPercent?: boolean; className?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
  return (
    <span className={cn("nb-upload-bar", className)}>
      <span className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
        <span className="fill" style={{ width: `${percent}%` }} />
      </span>
      {showPercent ? <span className="pct">{percent}%</span> : null}
    </span>
  );
}
