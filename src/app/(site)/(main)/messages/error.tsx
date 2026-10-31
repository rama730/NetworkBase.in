"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReportBoundaryError } from "@/lib/observability/use-report-boundary-error";

/** A Messages screen failed: the error replaces only the content pane, so the chat sidebar stays usable. */
export default function MessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportBoundaryError(error);

  return (
    <div role="alert" className="grid h-full place-items-center bg-card p-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="nb-card-title">This screen couldn’t load</h1>
        <p className="text-[13px] text-muted-foreground">{error.digest ? `Something went wrong (ref ${error.digest}).` : "Something went wrong."} Try again, or go back to Messages.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset} className="pointer-coarse:h-11">
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </Button>
          <Button asChild variant="outline" className="pointer-coarse:h-11"><Link href="/messages">Back to Messages</Link></Button>
        </div>
      </div>
    </div>
  );
}
