import { SkeletonLabel, SkeletonPage, SkeletonRows, SkeletonTabBar } from '@/components/ui/RouteSkeleton';

/** The trust and safety console while it loads: queue tabs and the inbox rows. */
export default function TrustLoading() {
    return (
        <SkeletonPage label="the console" wide>
            <SkeletonTabBar tabs={['Inbox', 'Cases', 'Appeals', 'People']} attached={false} />
            <SkeletonLabel>Inbox</SkeletonLabel>
            <SkeletonRows count={7} tile={32} action={false} />
        </SkeletonPage>
    );
}
