import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
    return (
        <div className="nb-sp" role="status" aria-label="Searching">
            <Skeleton className="h-7 w-72 rounded-[3px]" />
            <div className="mt-6 grid gap-3">
                {[0, 1, 2, 3].map((item) => <Skeleton key={item} kind="tile" className="h-24 w-full rounded-[6px]" />)}
            </div>
        </div>
    );
}
