import { Skeleton } from "@/components/ui/skeleton";
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SETTINGS_SECTIONS } from "@/lib/settings/navigation";

// How many blocks each section tends to have, so the page doesn't jump when the real sections arrive.
const BLOCKS: Record<(typeof SETTINGS_SECTIONS)[number], number> = {
  account: 2,
  security: 3,
  privacy: 2,
  notifications: 3,
  appearance: 2,
  integrations: 3,
  "privacy-policies": 1,
  "delete-account": 1,
};

/** Route fallback with the document's geometry: all eight sections, one status for the whole page. */
export default function SettingsLoading() {
  return (
    <OpenSettingsSections>
      <div role="status" aria-label="Loading settings" className="mx-auto w-full max-w-4xl pb-16">
        <span className="sr-only">Loading settings…</span>
        <div aria-hidden="true" className="space-y-16">
          {SETTINGS_SECTIONS.map((section) => (
            <div key={section} className="space-y-8">
              <div className="space-y-1.5">
                <Skeleton className="h-6 w-32 rounded" />
                <Skeleton className="h-4 w-64 max-w-full rounded" />
              </div>
              <SettingsSectionsSkeleton count={BLOCKS[section]} />
            </div>
          ))}
        </div>
      </div>
    </OpenSettingsSections>
  );
}
