import { PixelIcon } from "@/components/auth/pixel";

/** "Saved" in place, beside the thing that saved: a pixel tick and a mono SAVED that pop once and fades after 4 s. Give it a new `key` on each save so it shows again. */
export function SavedTick({ label = "Saved" }: { label?: string }) {
  return <span role="status" className="nb-saved"><PixelIcon name="check" />{label}</span>;
}
