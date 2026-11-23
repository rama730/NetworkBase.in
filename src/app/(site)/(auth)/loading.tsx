import Logo from '@/components/layout/header/Logo';
import { SkeletonForm } from '@/components/ui/RouteSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { SlowNote } from '@/components/ui/SlowNote';

/** Sign-in, sign-up and the other account pages while they load: the logo is there, the form takes its shape. */
export default function AuthLoading() {
    return (
        <main className="nb-auth nb-sk-auth" data-panel="false" role="status" aria-busy="true" aria-label="Loading">
            <span className="sr-only">Loading…</span>
            <div className="nb-auth-form">
                <header className="nb-auth-top"><div className="nb-auth-logo"><Logo /></div></header>
                <div className="nb-auth-wrap"><div className="nb-auth-column nb-sk-page" aria-hidden="true">
                    <Skeleton className="nb-sk-name" style={{ width: '70%' }} />
                    <Skeleton kind="text" style={{ width: '88%' }} />
                    <SkeletonForm fields={['Email', 'Password']} />
                </div></div>
                <SlowNote label="the page" />
            </div>
        </main>
    );
}
