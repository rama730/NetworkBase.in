"use client";

import { Button } from "@/components/ui/button";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";

export type SettingsLoadStatus = {
  loading: boolean;
  allowInteractionWhileLoading?: boolean;
  hasData: boolean;
  error: string | null;
  retry: () => void;
};
export function SettingsLoadState({
  loading,
  hasData,
  error,
  retry,
}: SettingsLoadStatus) {
  return (
    <>
      {error ? (
        <div
          role="alert"
          className="flex flex-col gap-3 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="nb-compact text-destructive">{error}</p>
            {hasData ? (
              <p className="nb-meta text-muted-foreground">
                Showing the last loaded settings. Retry before making changes.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            disabled={loading}
          >
            {loading ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}
      {loading && hasData ? <p role="status" className="nb-compact text-muted-foreground">Refreshing settings…</p> : null}
      {loading && !hasData ? (
        <div role="status" aria-label="Loading settings">
          <SettingsSectionsSkeleton count={1} />
        </div>
      ) : null}
    </>
  );
}
