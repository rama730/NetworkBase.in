import { SkeletonForm, SkeletonPage } from '@/components/ui/RouteSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

/** Onboarding while it loads: the step title and the step's fields. */
export default function OnboardingLoading() {
    return (
        <SkeletonPage label="your setup">
            <Skeleton kind="text" style={{ width: 90 }} />
            <Skeleton className="nb-sk-name" style={{ width: 'min(360px, 90%)' }} />
            <SkeletonForm fields={['Full name', 'Username', 'Headline']} />
        </SkeletonPage>
    );
}
