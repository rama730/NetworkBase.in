import { Skeleton } from "@/components/ui/skeleton";
import { WIZARD_PHASES } from "@/constants/workspace-wizard";
import { WIZARD_COLUMN } from "./WizardFooter";

/** Mirrors the create-project page inside the app shell: header band, 1000px column, footer band. */
export function CreateWorkspaceShellSkeleton() {
    return (
        <div role="status" aria-live="polite" aria-label="Loading workspace creation" className="flex h-full min-h-0 flex-col bg-card">
            <span className="sr-only">Loading workspace creation…</span>
            <div aria-hidden="true" className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6 md:h-16">
                <Skeleton className="h-5 w-36 rounded-sm" />
                <div className="hidden items-center gap-3 md:flex">
                    {WIZARD_PHASES.map((phase) => <Skeleton key={phase.id} className="h-6 w-16 rounded-sm lg:w-24" />)}
                </div>
                <Skeleton className="size-9 rounded-md" />
            </div>
            {/* 2px mobile progress bar matching WizardHeader */}
            <div aria-hidden="true" className="h-0.5 bg-muted md:hidden" />
            <div aria-hidden="true" className="min-h-0 flex-1 overflow-hidden">
                <div className={`${WIZARD_COLUMN} space-y-5 px-4 pb-6 pt-5 md:px-6 md:py-8`}>
                    <div className="space-y-2"><Skeleton className="h-6 w-56 max-w-full rounded-sm" /><Skeleton className="h-4 w-80 max-w-full rounded-sm" /></div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
                        {[1, 2, 3].map((tile) => <Skeleton key={tile} className="h-[88px] rounded-lg border border-border md:h-32" />)}
                    </div>
                </div>
            </div>
            <div aria-hidden="true" className="nb-wizard-footer shrink-0 border-t border-border bg-card">
                <div className={`${WIZARD_COLUMN} flex flex-col gap-2 px-4 pt-3 sm:grid sm:grid-cols-[minmax(8rem,1fr)_auto_minmax(8rem,1fr)] sm:items-center sm:gap-x-3 sm:gap-y-2 sm:px-6 sm:pt-4`}>
                    <div className="order-3 min-w-0 sm:order-1 sm:justify-self-start" />
                    <div className="order-1 flex justify-center sm:order-2 sm:justify-self-center">
                        <Skeleton className="h-4 w-36 rounded-sm" />
                    </div>
                    <div className="order-2 flex justify-end sm:order-3 sm:justify-self-end">
                        <Skeleton className="h-9 w-full min-w-[140px] rounded-md sm:w-28" />
                    </div>
                </div>
            </div>
        </div>
    );
}
