"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast, feedbackError } from "@/lib/feedback";

import {
  acceptApplicationAction,
  rejectApplicationAction,
  reopenApplicationAction,
  withdrawApplicationAction,
} from "@/app/actions/applications";
import { DecisionDialog, type DecisionInput } from "@/components/applications/DecisionDialog";
import { Actions, primary, secondary, Shell, STATUS_TONE, useCardAction, useCardQuery } from "@/components/messages/cards/card-parts";
import WithdrawApplicationDialog from "@/components/workspaces/dashboard/WithdrawApplicationDialog";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { reopenState, safeHttpUrl } from "@/lib/applications/utils";
import { APPLICATION_STATUS_LABEL } from "@/lib/messaging/application-status";
import { personName } from "@/lib/messaging/channel-view";
import { conversationHref } from "@/lib/messaging/routes";
import type { ApplicationCardView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";
import { profileHref } from "@/lib/routing/identifiers";
import { personCardSubtitle } from "@/lib/network/person-card";

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** A clock that ticks only while something on screen depends on it (the reopen countdown). */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Every control an application can offer in a thread, for whoever is looking: reviewers decide (Decline asks for a
 * reason), the applicant withdraws, and a fresh decline can be reopened for a few minutes.
 * The card and the status bar under the header render the same thing.
 */
export function ApplicationActions({ view, layout = "card" }: { view: ApplicationCardView; layout?: "card" | "bar" }) {
  const queryClient = useQueryClient();
  const { busy, run } = useCardAction("application", view.id);
  const [dialog, setDialog] = useState<"accept" | "decline" | "withdraw" | null>(null);
  const now = useNow(view.status === "rejected");
  const name = personName(view.applicant);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.chat.card("application", view.id) });
  const reopen = reopenState(view, now);

  const decide = (mode: "accept" | "decline") => async ({ reason, note }: DecisionInput) => {
    try {
      const result = mode === "accept"
        ? await acceptApplicationAction(view.id, note || undefined)
        : await rejectApplicationAction(view.id, note || undefined, reason);
      if (!result.success) return result.error || "The decision could not be saved. Try again.";
      setDialog(null);
      refresh();
      if (mode === "accept") toast.success(`${name} accepted`);
      else {
        toast.success(`${name} declined`, {
          action: {
            label: "Undo",
            onClick: () => void reopenApplicationAction(view.id).then((undone) => {
              refresh();
              if (!undone.success) toast.error(feedbackError(undone.error || "Couldn’t undo", "Couldn’t undo"));
            }),
          },
        });
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "The decision could not be saved. Try again.";
    }
  };

  const buttons = (
    <>
      {view.is_reviewer && view.status === "pending" ? (
        <>
          <button type="button" className={primary} disabled={busy || view.role_removed} onClick={() => setDialog("accept")} aria-label={`Accept ${name}'s application`}>Accept</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => setDialog("decline")} aria-label={`Decline ${name}'s application`}>Decline</button>
        </>
      ) : null}
      {view.is_reviewer && reopen.canReopen ? (
        <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => reopenApplicationAction(view.id), "Application reopened")} aria-label={`Reopen ${name}'s application`}>
          Reopen · {reopen.minutesLeft} min left
        </button>
      ) : null}
      {view.is_applicant && view.status === "pending" ? (
        <button type="button" className={secondary} disabled={busy} onClick={() => setDialog("withdraw")}>Withdraw</button>
      ) : null}
    </>
  );
  const dialogs = (
    <>
      <DecisionDialog open={dialog === "accept"} mode="accept" applicantName={name} roleTitle={view.role_title} onClose={() => setDialog(null)} onConfirm={decide("accept")} />
      <DecisionDialog open={dialog === "decline"} mode="decline" applicantName={name} roleTitle={view.role_title} onClose={() => setDialog(null)} onConfirm={decide("decline")} />
      <WithdrawApplicationDialog
        open={dialog === "withdraw"}
        roleTitle={view.role_title}
        onClose={() => setDialog(null)}
        onConfirm={async (note) => {
          const result = await withdrawApplicationAction(view.id, note || undefined);
          if (!result.success) return result.error || "Couldn’t withdraw the application.";
          setDialog(null);
          refresh();
          toast.success("Application withdrawn");
          return null;
        }}
      />
    </>
  );
  const empty = !(view.is_reviewer && (view.status === "pending" || reopen.canReopen)) && !(view.is_applicant && view.status === "pending");
  if (empty) return null;
  return (
    <>
      {layout === "card" ? <Actions>{buttons}</Actions> : <div className="flex flex-wrap items-center gap-2">{buttons}</div>}
      {view.is_reviewer && view.status === "pending" && view.role_removed ? (
        <p className="mt-2 text-xs text-muted-foreground">This role was removed, so it can only be declined.</p>
      ) : null}
      {dialogs}
    </>
  );
}

/** After an application is accepted: straight into the project and its chat. */
export function ApplicationLinks({ view }: { view: ApplicationCardView }) {
  if (view.status !== "accepted") return null;
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {view.project_chat_id ? <Link href={conversationHref(view.project_chat_id)} className="font-medium text-primary hover:underline">Open workspace chat</Link> : null}
      <Link href={`/workspaces/${view.project_slug ?? view.project_id}${view.is_applicant ? "?source=application_accepted" : ""}`} className="font-medium text-primary hover:underline">Open workspace</Link>
    </p>
  );
}

/** Where the application stands, in a line: who decided, when, and why. */
export function applicationOutcome(view: ApplicationCardView) {
  if (view.status === "pending") return null;
  const by = view.status === "withdrawn" ? "the applicant" : view.decided_by ? personName(view.decided_by) : "a reviewer";
  const verb = view.status === "accepted" ? "Accepted" : view.status === "rejected" ? "Declined" : "Withdrawn";
  return `${verb} by ${by}${view.decision_at ? ` · ${when(view.decision_at)}` : ""}`;
}

export function ApplicationCard({ view }: { view: ApplicationCardView }) {
  const outcome = applicationOutcome(view);
  const role = view.role_removed ? "a role that was removed" : view.role_title ?? "a role";
  const name = personName(view.applicant);
  // Headline, else @username, so the applicant is never just a name.
  const subtitle = personCardSubtitle({ headline: view.applicant_headline, username: view.applicant.username }).text;
  return (
    <Shell
      label="Application"
      status={view.status}
      statusLabel={APPLICATION_STATUS_LABEL[view.status]}
      ariaLabel={`Application by ${name} for ${role}, ${APPLICATION_STATUS_LABEL[view.status] ?? view.status}`}
    >
      <div className="flex items-start gap-2.5">
        <UserAvatar identity={view.applicant} size={32} />
        <div className="min-w-0">
          <p className="text-[15px] leading-snug">
            <Link href={profileHref(view.applicant)} className="font-medium hover:underline">{name}</Link>{" "}
            applied for <span className="font-medium">{role}</span> in{" "}
            <Link href={`/workspaces/${view.project_slug ?? view.project_id}`} className="text-primary hover:underline">{view.project_title}</Link>
          </p>
          {subtitle ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {view.applicant_skills.length || view.details.portfolioUrl || view.details.availability ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]" aria-label="About the applicant">
          {view.applicant_skills.map((skill) => <li key={skill} className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-muted-foreground">{skill}</li>)}
          {view.details.availability ? <li className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-foreground">{view.details.availability}</li> : null}
          {safeHttpUrl(view.details.portfolioUrl) ? (
            <li>
              <a href={safeHttpUrl(view.details.portfolioUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-primary hover:underline">Portfolio ↗</a>
            </li>
          ) : null}
        </ul>
      ) : null}
      {/* A mini log: mono date column, then what happened (no edge bar). */}
      <ol className="nbm-log">
        <li><span className="nbm-log-at">{when(view.created_at)}</span><span>Submitted</span></li>
        {outcome ? <li className="text-foreground"><span className="nbm-log-at">{view.decision_at ? when(view.decision_at) : ""}</span><span>{outcome.split(" · ")[0]}</span></li> : null}
        {view.status === "rejected" && view.decision_reason_text ? <li><span className="nbm-log-at" /><span>{view.decision_reason_text}</span></li> : null}
      </ol>
      <ApplicationLinks view={view} />
    </Shell>
  );
}

/**
 * Under the thread header: where the application stands and what you can do about it, always in view.
 * The card in the first message stays as the record; this is the control that doesn't scroll away.
 */
export function ApplicationStatusBar({ applicationId }: { applicationId: string }) {
  const query = useCardQuery("application", applicationId);
  const view = query.data && !("restricted" in query.data) && query.data.kind === "application" ? query.data : null;
  if (query.isError) return <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:px-4">Couldn’t load the application status. <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>Retry</button></div>;
  if (!view) return null;
  const outcome = applicationOutcome(view);
  const role = view.role_removed ? "Role removed" : view.role_title ?? "Role";
  return (
    <div className="nbm-appbar" role="group" aria-label={`Application status: ${APPLICATION_STATUS_LABEL[view.status] ?? view.status}`}>
      <span className="nb-status" data-status={STATUS_TONE[view.status] ?? "archived"} aria-live="polite">{APPLICATION_STATUS_LABEL[view.status] ?? view.status}</span>
      <p className="nbm-appbar-text">
        <Link href={`/workspaces/${view.project_slug ?? view.project_id}`} className="hover:text-foreground hover:underline">{role} · {view.project_title}</Link>
        {outcome ? <span> · {outcome}</span> : null}
      </p>
      <ApplicationActions view={view} layout="bar" />
      {view.status === "accepted" ? (
        <span className="flex flex-wrap gap-x-3 text-[13px]">
          {view.project_chat_id ? <Link href={conversationHref(view.project_chat_id)} className="font-medium text-primary hover:underline">Open general channel</Link> : null}
          <Link href={`/workspaces/${view.project_slug ?? view.project_id}${view.is_applicant ? "?source=application_accepted" : ""}`} className="font-medium text-primary hover:underline">Open workspace</Link>
        </span>
      ) : null}
    </div>
  );
}
