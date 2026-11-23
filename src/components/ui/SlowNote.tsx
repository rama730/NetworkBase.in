"use client";

import { useSlowFlag } from "@/lib/ui/delayed-flag";

/** After 3 s of loading, a quiet line says what is still on its way, so a long wait never looks frozen. */
export function SlowNote({ label, loading = true }: { label: string; loading?: boolean }) {
  const slow = useSlowFlag(loading);
  return (
    <p className="nb-sk-slow" data-on={slow || undefined} aria-hidden={!slow || undefined}>
      Still loading {label}…
    </p>
  );
}
