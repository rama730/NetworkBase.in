import { cn } from "@/lib/utils";

/**
 * Something is happening, length unknown: three pixel cells that light in turn (the mix's spinner; the app has no
 * spinning icons). Decorative unless `label` is given, which makes it a status for screen readers.
 */
export function PixelBeat({ className, label }: { className?: string; label?: string }) {
  return (
    <span className={cn("nb-pixel-beat", className)} {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}>
      <i />
      <i />
      <i />
    </span>
  );
}
