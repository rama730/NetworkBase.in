"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Check, ChevronDown } from "lucide-react";

import {
  acceptApplicationAction,
  acceptProposedRoleAction,
  declineProposedRoleAction,
  rejectApplicationAction,
  reopenApplicationAction,
  withdrawApplicationAction,
} from "@/app/actions/applications";
import { refreshCard } from "@/app/actions/chat/messages";
import { resolveProjectInvitationAction } from "@/app/actions/project/guidance";
import { updateTaskStatusAction, type TaskStatus } from "@/app/actions/task";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { personName } from "@/lib/messaging/channel-view";
import type { ApplicationCardView, ChatCardRef, ChatCardView, InviteCardView, TaskCardView } from "@/lib/messaging/types";
import { queryKeys } from "@/lib/query-keys";

type ActionResult = { success: boolean; error?: string };

/** Live cards (report 7.10 "Cards"): registry by kind; every action calls the existing domain action, then refetches the card. */
export function MessageCard({ card }: { card: ChatCardRef }) {
  const key = queryKeys.chat.card(card.kind, card.ref_id);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const result = await refreshCard({ kind: card.kind, refId: card.ref_id });
      // A failure is not "no access": throw, so it shows Retry.
      if (!result.success) throw new Error(result.error);
      return result.card ?? null;
    },
    staleTime: 5 * 60_000,
  });
  const view = query.data;
  if (query.isLoading) return <div role="status" className="mt-2 h-20 max-w-[480px] animate-pulse rounded-lg border border-border bg-card"><span className="sr-only">Loading {card.kind}…</span></div>;
  if (query.isError) {
    return (
      <div role="alert" className="mt-2 flex max-w-[480px] items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <span className="flex-1">This {card.kind} didn&apos;t load.</span>
        <button type="button" onClick={() => void query.refetch()} className="rounded-[5px] border border-border px-2.5 py-1 font-medium text-foreground hover:bg-muted">Retry</button>
      </div>
    );
  }
  if (!view || "restricted" in view) {
    return <div className="mt-2 max-w-[480px] rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">You don&apos;t have access to this {card.kind}.</div>;
  }
  return <CardBody view={view} />;
}

function CardBody({ view }: { view: Exclude<ChatCardView, { restricted: true }> }) {
  if (view.kind === "application") return <ApplicationCard view={view} />;
  if (view.kind === "task") return <TaskCard view={view} />;
  return <InviteCard view={view} />;
}

function useCardAction(kind: string, refId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<ActionResult>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (!result.success) toast.error(result.error || "That didn't work. Try again.");
      else toast.success(done);
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.card(kind, refId) });
    }
  };
  return { busy, run };
}

function Shell({ label, status, children }: { label: string; status: string | null; children: React.ReactNode }) {
  return (
    <div className="mt-2 max-w-[480px] rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="nb-micro text-muted-foreground">{label}</span>
        {status ? <span className="ml-auto rounded-[3px] bg-secondary px-1.5 py-0.5 font-mono text-[11px] capitalize">{status.replace(/_/g, " ")}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-col gap-2 sm:flex-row [&>button]:min-h-11 sm:[&>button]:min-h-[var(--ui-control-height)] [&>button]:rounded-[5px] [&>button]:px-3 [&>button]:text-[13px] [&>button]:font-medium [&>button:disabled]:opacity-50">{children}</div>;
}

const primary = "bg-primary text-primary-foreground";
const secondary = "border border-border bg-card";

function ApplicationCard({ view }: { view: ApplicationCardView }) {
  const { busy, run } = useCardAction("application", view.id);
  return (
    <Shell label="Application" status={view.status}>
      <div className="flex items-center gap-2">
        <UserAvatar identity={view.applicant} size={24} roundedClassName="rounded-[5px]" />
        <p className="min-w-0 text-[15px]">
          <span className="font-medium">{personName(view.applicant)}</span> applied for{" "}
          <span className="font-medium">{view.role_title ?? "a role"}</span> in{" "}
          <Link href={`/projects/${view.project_slug ?? view.project_id}`} className="text-primary hover:underline">{view.project_title}</Link>
        </p>
      </div>
      {view.message ? <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[13px] text-muted-foreground">{view.message}</p> : null}
      {view.is_reviewer && view.status === "pending" ? (
        <Actions>
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => acceptApplicationAction(view.id), "Application accepted")}>Accept</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => rejectApplicationAction(view.id), "Application declined")}>Decline</button>
        </Actions>
      ) : null}
      {view.is_reviewer && (view.status === "rejected" || view.status === "withdrawn") ? (
        <Actions>
          <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => reopenApplicationAction(view.id), "Application reopened")}>Reopen</button>
        </Actions>
      ) : null}
      {view.is_applicant && view.status === "pending" ? (
        <Actions>
          <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => withdrawApplicationAction(view.id), "Application withdrawn")}>Withdraw</button>
        </Actions>
      ) : null}
      {view.is_applicant && view.status === "proposed" ? (
        <Actions>
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => acceptProposedRoleAction(view.id), "Role accepted")}>Accept role</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => declineProposedRoleAction(view.id), "Role declined")}>Decline</button>
        </Actions>
      ) : null}
    </Shell>
  );
}

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: "To do", className: "bg-muted text-muted-foreground border-border hover:bg-muted/80" },
  in_progress: { label: "In progress", className: "bg-[var(--status-warning-soft)] text-[var(--status-warning)] border-[var(--status-warning)]/30 hover:opacity-90" },
  blocked: { label: "Blocked", className: "bg-[var(--status-danger-soft)] text-[var(--status-danger)] border-[var(--status-danger)]/30 hover:opacity-90" },
  done: { label: "Done", className: "bg-[var(--status-success-soft)] text-[var(--status-success)] border-[var(--status-success)]/30 hover:opacity-90" },
};

function TaskCard({ view }: { view: TaskCardView }) {
  const { busy, run } = useCardAction("task", view.id);
  const href = `/projects/${view.project_slug ?? view.project_id}?tab=tasks&drawerType=task&drawerId=${view.id}`;
  if (view.deleted) return <Shell label="Task" status="deleted"><p className="text-[13px] text-muted-foreground">This task was deleted.</p></Shell>;

  const currentStatusConfig = (TASK_STATUS_CONFIG as Record<string, { label: string; className: string }>)[view.status] ?? TASK_STATUS_CONFIG.todo;

  return (
    // The status shows once, as the coloured pill below (a menu for people who may change it).
    <Shell label={view.project_key && view.task_number ? `${view.project_key}-${view.task_number}` : "Task"} status={null}>
      <Link href={href} className="block text-[15px] font-medium text-foreground hover:underline">{view.title}</Link>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground/80">{view.project_title}</span>
        {view.assignee ? (
          <span className="inline-flex items-center gap-1.5">
            <UserAvatar identity={view.assignee} size={18} roundedClassName="rounded-[3px]" />
            <span>{personName(view.assignee)}</span>
          </span>
        ) : (
          <span>Unassigned</span>
        )}
        {view.due_date ? <span className="font-mono text-[12px]">Due {new Date(view.due_date).toLocaleDateString()}</span> : null}

        <div className="ml-auto">
          {view.can_edit === false ? (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${currentStatusConfig.className}`}>{currentStatusConfig.label}</span>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors ${currentStatusConfig.className} disabled:opacity-50`}
              aria-label={`Status: ${currentStatusConfig.label}. Click to change.`}
            >
              <span>{currentStatusConfig.label}</span>
              <ChevronDown size={12} className="opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map((statusKey) => {
                const conf = TASK_STATUS_CONFIG[statusKey];
                return (
                  <DropdownMenuItem
                    key={statusKey}
                    onSelect={() => void run(() => updateTaskStatusAction(view.id, statusKey, view.project_id), `Task marked as ${conf.label}`)}
                    className="flex items-center justify-between"
                  >
                    <span>{conf.label}</span>
                    {view.status === statusKey ? <Check size={14} className="text-primary" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
        </div>
      </div>
    </Shell>
  );
}

function InviteCard({ view }: { view: InviteCardView }) {
  const { busy, run } = useCardAction("invite", view.id);
  const [openedAt] = useState(() => Date.now());
  const expired = view.status === "pending" && Date.parse(view.expires_at) < openedAt;
  return (
    <Shell label="Invitation" status={expired ? "expired" : view.status}>
      <p className="text-[15px]">
        <span className="font-medium">{personName(view.inviter)}</span> invited {view.is_candidate ? "you" : "them"} to join{" "}
        <Link href={`/projects/${view.project_slug ?? view.project_id}`} className="text-primary hover:underline">{view.project_title}</Link>
        {view.role_title ? <> as <span className="font-medium">{view.role_title}</span></> : view.guidance_label ? <> as <span className="font-medium">{view.guidance_label}</span></> : null}
      </p>
      {view.note ? <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">{view.note}</p> : null}
      {view.status === "pending" && !expired ? (
        <Actions>
          {view.is_candidate ? (
            <>
              <button type="button" className={primary} disabled={busy} onClick={() => void run(() => resolveProjectInvitationAction({ invitationId: view.id, action: "accept" }), "Invitation accepted")}>Accept</button>
              <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => resolveProjectInvitationAction({ invitationId: view.id, action: "decline" }), "Invitation declined")}>Decline</button>
            </>
          ) : null}
          {view.can_cancel ? (
            <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => resolveProjectInvitationAction({ invitationId: view.id, action: "cancel" }), "Invitation cancelled")}>Cancel invitation</button>
          ) : null}
        </Actions>
      ) : null}
    </Shell>
  );
}
