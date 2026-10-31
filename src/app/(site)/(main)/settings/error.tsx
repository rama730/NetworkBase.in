"use client";

import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { useReportBoundaryError } from "@/lib/observability/use-report-boundary-error";

/** A failure inside Settings keeps the settings navigation on screen and offers a retry, with no technical text. */
export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportBoundaryError(error);

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ErrorNotice what="Settings" onRetry={reset} />
    </div>
  );
}
