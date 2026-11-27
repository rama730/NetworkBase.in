"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";

import { readBoardMeetingsAction } from "@/app/actions/board-meetings";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";

const NewMeetingDialog = dynamic(() => import("@/components/workspaces/doc/DocMeeting").then((m) => m.NewMeetingDialog), { ssr: false });
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Board meetings (B8.5, the Nonprofit kit): upcoming and recent ones, Plan a board meeting for owner and admins. */
export function BoardMeetingsCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: ["board-meetings", orgId], queryFn: () => readBoardMeetingsAction(orgId), staleTime: 60_000 });
  const [planning, setPlanning] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d || (!d.meetings.length && !d.canPlan)) return null;
  return (
    <OrgCard title={d.all ? "Meetings" : "Board meetings"} testId="board-meetings" action={d.canPlan ? <button type="button" className="nb-link text-[13px]" onClick={() => setPlanning(true)}>{d.all ? "Plan a meeting" : "Plan a board meeting"}</button> : null}>
      <div className="space-y-2 text-[13px]">
        {d.meetings.length ? <ul className="space-y-1">{d.meetings.map((m) => <li key={m.slug} className="flex flex-wrap items-center gap-2" data-testid="board-meeting">
          <Gavel aria-hidden="true" className="size-4 text-muted-foreground" /><a className="nb-link" href={`${base}?tab=docs&doc=${encodeURIComponent(m.slug)}`}>{m.title}</a>
          {m.startsAt ? <span className="text-muted-foreground">{when(m.startsAt)}</span> : null}{m.approved ? <StatusBadge state="done">Minutes approved</StatusBadge> : null}</li>)}</ul>
          : <p className="text-muted-foreground">{d.all ? "No meetings yet." : "No board meetings yet. Each has motions, votes, a quorum line and minutes approved at the next one."}</p>}
        {d.canPlan && !d.meetings.length ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPlanning(true)}>{d.all ? "Plan a meeting" : "Plan a board meeting"}</button> : null}
        {planning ? <NewMeetingDialog projectId={orgId} initialType={d.all ? undefined : "board"} open={planning} onOpenChange={(o) => { setPlanning(o); if (!o) void q.refetch(); }} /> : null}
      </div>
    </OrgCard>
  );
}
