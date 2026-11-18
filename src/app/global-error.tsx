"use client";

import { glyph7, isMissingPiece } from "@/lib/grid-trail";
import { useReportBoundaryError } from "@/lib/observability/use-report-boundary-error";

/** The pixel 500, drawn without the grid engine: the root layout failed, so nothing else of the app has loaded. */
function Pixel500() {
  const cells: { x: number; y: number; orange: boolean }[] = [];
  [..."500"].forEach((ch, n) => glyph7(ch).forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit === "#") cells.push({ x: n * 6 + x, y, orange: n === 0 && isMissingPiece(ch, x, y) });
  })));
  return (
    <svg width="204" height="84" viewBox="0 0 17 7" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block", margin: "0 auto 20px" }}>
      {cells.map(({ x, y, orange }) => <rect key={`${x}-${y}`} x={x + 0.06} y={y + 0.06} width="0.88" height="0.88" fill={orange ? "#D14E24" : "#374349"} />)}
    </svg>
  );
}

/** The root layout itself failed, so none of the app's styles are loaded: this page carries its own. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useReportBoundaryError(error);
  const button = { padding: "10px 18px", borderRadius: 5, font: "500 14px system-ui, sans-serif", cursor: "pointer" } as const;

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#FAF8F4", color: "#141A1E", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24, backgroundImage: "linear-gradient(to right, rgb(33 42 48 / 7%) 1px, transparent 1px), linear-gradient(to bottom, rgb(33 42 48 / 7%) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        <main role="alert">
          <Pixel500 />
          <h1 style={{ margin: "0 0 8px", font: "400 34px/1.15 'Instrument Serif', Georgia, serif" }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Error 500. </span>Something went wrong.</h1>
          <p style={{ margin: "0 0 24px", color: "#4C5A61" }}>It’s on our side, not yours. Try again in a moment.</p>
          <button type="button" onClick={() => retry()} style={{ ...button, background: "#C24720", color: "#fff", border: "1px solid #C24720" }}>
            Try again
          </button>{" "}
          {/* No app components load here; a plain way back (unified back A1). */}
          {/* eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the root layout failed, so there is no router */}
          <button type="button" onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/discover"))} style={{ ...button, background: "#fff", color: "#141A1E", border: "1px solid #DBD5C8" }}>
            Go back
          </button>
          {error.digest ? <p style={{ marginTop: 20, font: "11px ui-monospace, monospace", color: "#4C5A61" }}>Reference {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
