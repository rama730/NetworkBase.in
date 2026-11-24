"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin } from "@/components/ui/icons";
import Link from "next/link";

import { readMyOffsiteInvitesAction } from "@/app/actions/goal-checkins";
import { queryKeys } from "@/lib/query-keys";

/** Report 38.14 W2 (plan A5.4): off-sites you haven't answered, each opening its document's Going / Can't go. */
export function OffsiteInvites() {
  const query = useQuery({ queryKey: queryKeys.myWork.offsiteInvites(), queryFn: () => readMyOffsiteInvitesAction(), staleTime: 60_000 });
  const rows = query.data?.success ? query.data.invites : [];
  if (!rows.length) return null;
  return (
    <section aria-label="Off-sites to answer" className="space-y-1 px-1 pb-2" data-testid="my-work-offsites">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex items-center gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px] hover:bg-muted">
              <MapPin aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{r.name}: are you going?</span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.dateFrom}</span>
              <span className="truncate text-[11px] text-muted-foreground">{r.workspace}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
