import { cn } from "@/lib/utils";

/** One counter for every limited field: "7 / 80" in mono; brand near the limit (90%), red past it. */
export function CharCount({ value, max, className, id }: { value: number; max: number; className?: string; id?: string }) {
  const near = value >= max * 0.9 && value <= max;
  return (
    <span id={id} className={cn("nb-count", className)} data-near={near || undefined} data-over={value > max || undefined}>
      {value.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}
