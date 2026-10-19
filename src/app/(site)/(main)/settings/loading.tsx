import { Skeleton } from "@/components/ui/skeleton";
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";

/** Layout-preserving route fallback matching SettingsDocument geometry (replaces NAV_ITEM_SKELETONS) without duplicating the shell navigation sidebar. */
export default function SettingsLoading() {
  return (
    <OpenSettingsSections>
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading settings"
        className="mx-auto w-full max-w-4xl pb-16"
      >
        <span className="sr-only">Loading settings…</span>
        <div className="space-y-16">
          {/* Section 1 Skeleton */}
          <div className="space-y-8">
            <div>
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-32 rounded" />
                <Skeleton className="h-4 w-64 max-w-full rounded" />
              </div>
            </div>
            <SettingsSectionsSkeleton count={3} />
          </div>

          {/* Section 2 Skeleton */}
          <div className="space-y-8">
            <div>
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-36 rounded" />
                <Skeleton className="h-4 w-72 max-w-full rounded" />
              </div>
            </div>
            <SettingsSectionsSkeleton count={3} />
          </div>
        </div>
      </div>
    </OpenSettingsSections>
  );
}
