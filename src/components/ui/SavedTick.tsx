import { Check } from "lucide-react";

/** "Saved" in place, beside the thing that saved: a tick that pops once. Give it a new `key` on each save so it pops again. */
export function SavedTick({ label = "Saved" }: { label?: string }) {
  return <span role="status" className="nb-saved"><Check className="size-3.5" aria-hidden="true" />{label}</span>;
}
