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
import TaskStatusBadge from "@/components/projects/v2/tasks/badges/TaskStatusBadge";
import { buttonVariants } from "@/components/ui/button";
import { ErrorNotice } from "@/components/messages/parts/ErrorNotice";
import { getTaskStatusLabel } from "@/lib/projects/task-presentation";
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
  if (query.isLoading) return <div role="status" className="nb-skeleton mt-2 h-20 max-w-[480px] rounded-lg border border-border"><span className="sr-only">Loading {card.kind}…</span></div>;
  if (query.isError) return <ErrorNotice what={`This ${card.kind}`} onRetry={() => void query.refetch()} className="mt-2 max-w-[480px]" />;
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
        {status ? <span className="nb-status ml-auto" data-status={STATUS_TONE[status] ?? "archived"}>{status.replace(/_/g, " ")}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-col gap-2 sm:flex-row">{children}</div>;
}

// The shared Button looks, 44px on touch.
const primary = buttonVariants({ className: "pointer-coarse:h-11" });
const secondary = buttonVariants({ variant: "outline", className: "pointer-coarse:h-11" });
// Card states on the shared status chip (spec: status colours mean status).
const STATUS_TONE: Record<string, string> = {
  pending: "draft", proposed: "draft", accepted: "completed", rejected: "blocked", declined: "blocked",
  withdrawn: "archived", cancelled: "archived", expired: "archived", deleted: "archived",
};

function ApplicationCard({ view }: { view: ApplicationCardView }) {
  const { busy, run } = useCardAction("application", view.id);
  return (
    <Shell label="Application" status={view.status}>
      <div className="flex items-center gap-2">
        <UserAvatar identity={view.applicant} size={26} />
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

const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

function TaskCard({ view }: { view: TaskCardView }) {
  const { busy, run } = useCardAction("task", view.id);
  const href = `/projects/${view.project_slug ?? view.project_id}?tab=tasks&drawerType=task&drawerId=${view.id}`;
  if (view.deleted) return <Shell label="Task" status="deleted"><p className="text-[13px] text-muted-foreground">This task was deleted.</p></Shell>;

  const statusLabel = getTaskStatusLabel(view.status);

  return (
    // The status shows once, as the coloured pill below (a menu for people who may change it).
    <Shell label={view.project_key && view.task_number ? `${view.project_key}-${view.task_number}` : "Task"} status={null}>
      <Link href={href} className="block text-[15px] font-medium text-foreground hover:underline">{view.title}</Link>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{view.project_title}</span>
        {view.assignee ? (
          <span className="inline-flex items-center gap-1.5">
            <UserAvatar identity={view.assignee} size={20} />
            <span>{personName(view.assignee)}</span>
          </span>
        ) : (
          <span>Unassigned</span>
        )}
        {view.due_date ? <span className="nb-meta">Due {new Date(view.due_date).toLocaleDateString()}</span> : null}

        {/* The app's own task status badge (same colours as the Tasks board). */}
        <div className="ml-auto">
          {view.can_edit === false ? (
            <TaskStatusBadge status={view.status} />
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-sm disabled:opacity-50 pointer-coarse:min-h-11"
              aria-label={`Status: ${statusLabel}. Click to change.`}
            >
              <TaskStatusBadge status={view.status} />
              <ChevronDown size={14} className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {TASK_STATUSES.map((statusKey) => (
                <DropdownMenuItem
                  key={statusKey}
                  onSelect={() => void run(() => updateTaskStatusAction(view.id, statusKey, view.project_id), `Task marked as ${getTaskStatusLabel(statusKey)}`)}
                  className="flex items-center justify-between"
                >
                  <span>{getTaskStatusLabel(statusKey)}</span>
                  {view.status === statusKey ? <Check className="text-primary" /> : null}
                </DropdownMenuItem>
              ))}
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
