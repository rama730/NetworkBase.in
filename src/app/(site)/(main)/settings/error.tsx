"use client";

import { useEffect } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { logger } from "@/lib/logger";

/** A failure inside Settings keeps the settings navigation on screen and offers a retry, with no technical text. */
export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    logger.error("settings.render_failed", { module: "settings", error: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      <ErrorNotice what="Settings" onRetry={reset} />
    </div>
  );
}
