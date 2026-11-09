"use client";

import { useReportBoundaryError } from "@/lib/observability/use-report-boundary-error";

/** The root layout itself failed, so none of the app's styles are loaded: this page carries its own. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useReportBoundaryError(error);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
        <main role="alert">
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p>Try again in a moment.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", cursor: "pointer" }}>
            Try again
          </button>{" "}
          {/* No app components load here; a plain way back (unified back A1). */}
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the root layout failed, so there is no router */}
          <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/discover"))} style={{ padding: "8px 16px", cursor: "pointer" }}>
            Go back
          </button>
        </main>
      </body>
    </html>
  );
}
