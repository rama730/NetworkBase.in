"use client";

import Link from "next/link";
import { useState } from "react";

import { Check, ChevronDown } from "lucide-react";

import { resolveProjectInvitationAction } from "@/app/actions/project/guidance";
import { updateTaskStatusAction, type TaskStatus } from "@/app/actions/task";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import TaskStatusBadge from "@/components/projects/v2/tasks/badges/TaskStatusBadge";
import { ApplicationCard } from "@/components/messages/cards/ApplicationCard";
import { Actions, primary, secondary, Shell, useCardAction, useCardQuery } from "@/components/messages/cards/card-parts";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { getTaskStatusLabel } from "@/lib/projects/task-presentation";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { personName } from "@/lib/messaging/channel-view";
import type { AnnouncementCardView, AssignmentCardView, ChatCardRef, ChatCardView, InviteCardView, TaskCardView } from "@/lib/messaging/types";

/** Live cards (report 7.10 "Cards"): registry by kind; every action calls the existing domain action, then refetches the card. */
export function MessageCard({ card }: { card: ChatCardRef }) {
  const query = useCardQuery(card.kind, card.ref_id);
  const view = query.data;
  if (query.isLoading) return <div role="status" className="nb-skeleton mt-2 h-20 max-w-[480px] rounded-lg border border-border"><span className="sr-only">Loading {card.kind}…</span></div>;
  if (query.isError) return <ErrorNotice what={`This ${card.kind}`} onRetry={() => void query.refetch()} className="mt-2 max-w-[480px]" />;
  if (!view || "restricted" in view) {
    return <div className="mt-2 max-w-[480px] rounded-lg border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">You don’t have access to this {card.kind}.</div>;
  }
  return <CardBody view={view} />;
}

function CardBody({ view }: { view: Exclude<ChatCardView, { restricted: true }> }) {
  if (view.kind === "application") return <ApplicationCard view={view} />;
  if (view.kind === "task") return <TaskCard view={view} />;
  if (view.kind === "announcement") return <AnnouncementCard view={view} />;
  if (view.kind === "assignment") return <AssignmentCard view={view} />;
  return <InviteCard view={view} />;
}

/** An org announcement shared in #general (report §25.5): first lines and Open in Updates. */
function AnnouncementCard({ view }: { view: AnnouncementCardView }) {
  const href = `/org/${view.project_slug ?? view.project_id}?tab=updates&updateId=${view.id}`;
  if (view.deleted) return <Shell label="Announcement" status="deleted"><p className="text-[13px] text-muted-foreground">This announcement was removed.</p></Shell>;
  return (
    <Shell label={`Announcement · ${view.project_title}`} status={null}>
      <p className="line-clamp-4 whitespace-pre-line text-[14px] text-foreground">{view.content}</p>
      <Actions><Link href={href} className={secondary}>Open in Updates</Link></Actions>
    </Shell>
  );
}

const COPY_STATE_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", submitted: "Submitted", returned: "Returned for changes", done: "Completed", missing: "Missing", excused: "Excused" };

/** An assignment shared in #general: your own status, or counts for owners and admins (report §25.5). */
function AssignmentCard({ view }: { view: AssignmentCardView }) {
  const base = `/org/${view.project_slug ?? view.project_id}?tab=tasks`;
  if (view.deleted) return <Shell label="Assignment" status="deleted"><p className="text-[13px] text-muted-foreground">This assignment was deleted.</p></Shell>;
  const status = view.own ? `${COPY_STATE_LABEL[view.own.state] ?? view.own.state}${view.own.late ? " · late" : ""}` : view.counts ? `${view.counts.submitted} of ${view.counts.total} submitted` : null;
  return (
    <Shell label={`Assignment · ${view.project_title}`} status={null}>
      <p className="text-[15px] font-medium text-foreground">{view.title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {view.due_date ? `Due ${new Date(view.due_date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : "No due date"}
        {status ? ` · ${status}` : ""}
      </p>
      <Actions>
        <Link href={view.own ? `${base}&drawerType=task&drawerId=${view.own.copy_id}` : base} className={primary}>{view.own ? "Open assignment" : "Open assignments"}</Link>
      </Actions>
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
            <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => resolveProjectInvitationAction({ invitationId: view.id, action: "cancel" }), "Invitation canceled")}>Cancel invitation</button>
          ) : null}
        </Actions>
      ) : null}
    </Shell>
  );
}
