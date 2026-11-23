import { Skeleton } from "@/components/ui/skeleton";
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import { SettingsSectionsSkeleton } from "@/components/settings/ui/SettingsSectionsSkeleton";
import { SETTINGS_SECTIONS } from "@/lib/settings/navigation";

// How many groups each section tends to have, so the page doesn't jump when the real sections arrive.
const BLOCKS: Record<(typeof SETTINGS_SECTIONS)[number], number> = {
  account: 3,
  security: 3,
  privacy: 4,
  notifications: 4,
  appearance: 4,
  integrations: 3,
  "privacy-policies": 3,
  "delete-account": 1,
};

/** Route fallback with the document's geometry (mix): the band, then all eight frames, one status for the page. */
export default function SettingsLoading() {
  return (
    <OpenSettingsSections>
      <div role="status" aria-label="Loading settings" className="mx-auto grid w-full max-w-[900px] gap-6 pb-16">
        <span className="sr-only">Loading settings…</span>
        <div aria-hidden="true" className="nbs-band">
          <div className="nbs-band-in">
            <p className="nbs-eyebrow">Settings</p>
            <Skeleton className="size-[76px] rounded-md max-sm:size-14" />
            <div className="grid gap-2.5"><Skeleton className="h-7 w-60 max-w-full" /><Skeleton className="h-3 w-64 max-w-full" /></div>
            <div />
          </div>
          <div className="nbs-stats">{[0, 1, 2, 3, 4].map((cell) => <div key={cell} className="nbs-stat"><Skeleton className="h-2 w-14" /><Skeleton className="h-5 w-12" /></div>)}</div>
        </div>
        {SETTINGS_SECTIONS.map((section) => (
          <div key={section} aria-hidden="true" className="nbs-frame">
            <div className="nbs-fhead"><Skeleton className="h-2.5 w-28" /><Skeleton className="h-6 w-72 max-w-[80%]" /><Skeleton className="h-3 w-[440px] max-w-[90%]" /></div>
            <SettingsSectionsSkeleton count={BLOCKS[section]} />
          </div>
        ))}
      </div>
    </OpenSettingsSections>
  );
}
