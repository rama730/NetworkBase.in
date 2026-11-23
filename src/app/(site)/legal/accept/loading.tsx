import { SkeletonPage, SkeletonPanel } from '@/components/ui/RouteSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/** The updated-terms page while it loads: what changed, then the button. */
export default function AcceptLoading() {
    return (
        <SkeletonPage label="the updated terms">
            <Skeleton className="nb-sk-name" style={{ width: 280 }} />
            <SkeletonPanel lines={5} />
            <Skeleton className="nb-sk-input is-btn" style={{ width: 160 }} />
        </SkeletonPage>
    );
}
