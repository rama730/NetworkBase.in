"use client";

import { InlineError } from "@/components/errors/ErrorPages";
import { useReportBoundaryError } from "@/lib/observability/use-report-boundary-error";

/** A Messages screen failed: the error replaces only the content pane, so the chat sidebar stays usable. */
export default function MessagesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportBoundaryError(error);
  return (
    <div className="h-full bg-card">
      <InlineError reset={reset} digest={error.digest} label="Error · Messages" title="This screen couldn’t load" back={{ href: "/messages", label: "Back to Messages" }} />
    </div>
  );
}
