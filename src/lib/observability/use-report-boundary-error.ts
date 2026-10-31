import { captureException } from "@sentry/nextjs";
import { useEffect } from "react";

// Next replaces a server error's message and sets a digest; the server has already reported the real one.
// A client component can throw anything, even null, and the error screen must survive it.
export function shouldReportBoundaryError(error: { digest?: string } | null | undefined) {
  return !error?.digest;
}

// An error screen handles the error, so the browser's global handler never sees it.
export function useReportBoundaryError(error: Error & { digest?: string }) {
  useEffect(() => {
    if (shouldReportBoundaryError(error)) captureException(error);
  }, [error]);
}
