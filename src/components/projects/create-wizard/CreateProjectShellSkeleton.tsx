import { Skeleton } from "@/components/ui/skeleton";
import { WIZARD_PHASES } from "@/constants/project-wizard";
import { WIZARD_COLUMN } from "./WizardFooter";

/** Mirrors the full-page create-project screen: header band, 1000px column, footer band. */
export function CreateProjectShellSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading project creation" className="flex h-dvh min-h-0 flex-col bg-card">
            <span className="sr-only">Loading project creation…</span>
            <div aria-hidden="true" className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6 md:h-16">
                <Skeleton className="h-5 w-36 rounded-sm" />
                <div className="hidden items-center gap-3 md:flex">
                    {WIZARD_PHASES.map((phase) => <Skeleton key={phase.id} className="h-6 w-16 rounded-sm lg:w-24" />)}
                </div>
                <Skeleton className="size-9 rounded-md" />
            </div>
            <div aria-hidden="true" className="min-h-0 flex-1 overflow-hidden">
                <div className={`${WIZARD_COLUMN} space-y-5 px-4 pb-6 pt-5 md:px-6 md:py-8`}>
                    <div className="space-y-2"><Skeleton className="h-6 w-56 max-w-full rounded-sm" /><Skeleton className="h-4 w-80 max-w-full rounded-sm" /></div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                        {[1, 2, 3].map((tile) => <Skeleton key={tile} className="h-[88px] rounded-lg border border-border md:h-32" />)}
                    </div>
                </div>
            </div>
            <div aria-hidden="true" className="nb-wizard-footer shrink-0 border-t border-border">
                <div className={`${WIZARD_COLUMN} flex items-center justify-end gap-2 px-4 pt-3 sm:px-6 sm:pt-4`}>
                    <Skeleton className="size-9 rounded-md" />
                    <Skeleton className="h-9 w-28 rounded-md max-sm:flex-1" />
                </div>
            </div>
        </div>
    );
}
