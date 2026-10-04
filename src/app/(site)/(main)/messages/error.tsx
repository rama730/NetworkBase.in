"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

/** A Messages screen failed: the error replaces only the content pane, so the chat sidebar stays usable. */
export default function MessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="grid h-full place-items-center bg-card p-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-[17px] font-semibold">This screen didn&apos;t load</h1>
        <p className="text-[13px] text-muted-foreground">{error.digest ? `Something went wrong (ref ${error.digest}).` : "Something went wrong."} Try again, or go back to Messages.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 pointer-coarse:h-11">
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
          <Link href="/messages" className="inline-flex h-9 items-center rounded-[5px] border border-border px-3 text-[13px] font-medium hover:bg-muted pointer-coarse:h-11">Back to Messages</Link>
        </div>
      </div>
    </div>
  );
}
