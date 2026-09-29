import { Skeleton } from "@/components/ui/skeleton";
import { PERSON_CARD_ITEM_HEIGHT, PersonCardLayout } from "@/components/network/PersonCard";

// Mirrors PersonCardLayout geometry so loading and loaded cards share size and alignment.
export function PersonCardSkeleton() {
    return (
        <div aria-hidden="true" className={PERSON_CARD_ITEM_HEIGHT}>
            <PersonCardLayout
                avatar={<Skeleton className="size-12 shrink-0 rounded-[8px]" />}
                head={<div className="space-y-2"><Skeleton className="h-4 w-32 max-w-full rounded-[4px]" /><Skeleton className="h-3 w-28 max-w-full rounded-[3px]" /></div>}
                body={
                    <>
                        <Skeleton className="h-3.5 w-48 max-w-full rounded-[3px]" />
                        <div className="flex gap-1.5"><Skeleton className="h-5 w-16 rounded-[4px]" /><Skeleton className="h-5 w-14 rounded-[4px]" /></div>
                    </>
                }
                actions={<Skeleton className="h-[var(--ui-control-height)] w-24 rounded-md" />}
            />
        </div>
    );
}
