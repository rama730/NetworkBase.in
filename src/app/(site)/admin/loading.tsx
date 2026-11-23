import { SkeletonLabel, SkeletonPage, SkeletonPanel, SkeletonRows } from '@/components/ui/RouteSkeleton';

/** Admin pages (reports, notifications) while they load: a summary panel and rows. */
export default function AdminLoading() {
    return (
        <SkeletonPage label="admin" wide>
            <SkeletonPanel lines={2} />
            <SkeletonLabel>Recent</SkeletonLabel>
            <SkeletonRows count={6} tile={false} action={false} />
        </SkeletonPage>
    );
}
