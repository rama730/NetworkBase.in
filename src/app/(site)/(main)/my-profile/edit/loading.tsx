import { Skeleton } from '@/components/ui/skeleton';

/** Edit profile's loading shape: the preview band, the section tabs, the form beside the Changes card. */
export default function EditProfileLoading() {
    return <div role="status" aria-label="Loading profile editor" className="h-full min-h-0 overflow-hidden bg-background">
        <div aria-hidden="true" className="nb-pf-page">
            <div className="nb-pf-band"><div className="flex gap-4 p-5"><Skeleton className="size-20 shrink-0 rounded-[6px]" /><div className="min-w-0 flex-1 space-y-2.5 pt-1"><Skeleton className="h-8 w-56 max-w-full" /><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-72 max-w-full" /></div></div></div>
            <div className="nb-pf-tabbar"><div className="flex min-h-11 items-center gap-6 px-5">{[16, 24, 14, 12, 24].map((w, i) => <Skeleton key={i} className="h-4" style={{ width: `${w * 4}px` }} />)}</div></div>
            <div className="nb-pf-body">
                <div className="nb-pf-col"><span className="nb-pf-label has-rule">Photo</span><Skeleton className="h-28 w-full rounded-[8px]" /><span className="nb-pf-label has-rule">Identity</span><Skeleton className="h-48 w-full rounded-[8px]" /></div>
                <div className="nb-pf-rail"><Skeleton className="h-72 w-full rounded-[8px]" /></div>
            </div>
        </div>
        <span className="sr-only">Loading profile editor…</span>
    </div>;
}
