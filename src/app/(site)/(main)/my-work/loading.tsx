import { SkeletonLabel, SkeletonPage, SkeletonRows, SkeletonTabBar } from '@/components/ui/RouteSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/** My work while it loads: the band with the week strip, the tabs, then task rows. */
export default function MyWorkLoading() {
    return (
        <SkeletonPage label="your tasks">
            <section className="nb-pf-band nb-sk-band">
                <div className="nb-sk-band-in is-mw">
                    <Skeleton className="nb-sk-name" style={{ width: 'min(420px, 80%)' }} />
                    <div className="nb-sk-week">{['Late', 'Today', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}<Skeleton style={{ width: 22, height: 6 }} /></span>)}</div>
                </div>
            </section>
            <SkeletonTabBar tabs={['Tasks', 'Requests']} />
            <SkeletonLabel>Due this week</SkeletonLabel>
            <SkeletonRows count={4} tile={26} action={false} />
            <SkeletonLabel>No date</SkeletonLabel>
            <SkeletonRows count={3} tile={26} action={false} />
        </SkeletonPage>
    );
}
