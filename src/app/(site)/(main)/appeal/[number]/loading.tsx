import { SkeletonPage, SkeletonPanel } from '@/components/ui/RouteSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/** An appeal while it loads: its title, the decision being appealed, and the thread. */
export default function AppealLoading() {
    return (
        <SkeletonPage label="the appeal">
            <Skeleton className="nb-sk-name" style={{ width: 220 }} />
            <SkeletonPanel label="Decision" lines={3} />
            <SkeletonPanel label="Your appeal" lines={4} />
        </SkeletonPage>
    );
}
