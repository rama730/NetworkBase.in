"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { revokeExtensionSession } from "@/app/actions/extension-sessions";
import { updateWorkspace } from "@/app/actions/workspace";
import {
  completeMyPartAction, getMyPartAction, leaveWorkspaceAction, previewWrapUpAction, readMyAgentsAndDevicesAction,
  reopenMyPartAction, requestRoleAction, undoMemberJourneyAction, updateMySettingsAction,
} from "@/app/actions/workspace/member-journey";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { useMemberUpdates } from "@/hooks/useMemberUpdates";
import { feedbackError, toast } from "@/lib/feedback";
import { WORKSPACE_NOTIFICATION_EVENT_REGISTRY, WORKSPACE_NOTIFICATION_GROUPS } from "@/lib/notifications/workspace-policy";
import type { WorkspaceSettingsMember } from "@/lib/workspaces/settings-policies";
import type { MySettingsPatch } from "@/lib/workspaces/member-journey";

/**
 * Workspace settings → Your settings (member settings Part 1–3): your part here, notifications, how your work shows,
 * your agents and devices, your view, and Leave. Every role sees it first; it only ever changes things for you.
 */
type Part = Extract<Awaited<ReturnType<typeof getMyPartAction>>, { success: true }>["data"];
type WrapUp = Extract<Awaited<ReturnType<typeof previewWrapUpAction>>, { success: true }>["data"];
type TaskChoice = "keep" | "give" | "unassign";

const partKey = (id: string) => ["project", id, "my-part"] as const;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const month = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const ROLE_WORD = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" } as const;
const MENTION_KEYS = new Set(["tasks.mentions", "updates.mention", "tasks.replies", "updates.reply"]);
const OVERRIDABLE = Object.values(WORKSPACE_NOTIFICATION_EVENT_REGISTRY).filter((e) => e.visible && !e.key.startsWith("org."));
const TABS = [["overview", "Overview"], ["tasks", "Tasks"], ["sprints", "Sprints"], ["docs", "Docs"], ["updates", "Updates"], ["files", "Files"]] as const;

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/** The 10-second Undo from the toast (report §3, §4). */
function offerUndo(message: string, undoId: string | null | undefined, after: () => void) {
  if (!undoId) { toast.success(message); return; }
  toast(message, {
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: async () => {
        const r = await undoMemberJourneyAction(undoId);
        if (r.success) { toast.success("Undone"); after(); } else toast.error(feedbackError(r.error, "Couldn’t undo"));
      },
    },
  });
}

export function YourSettingsSection({ projectId, projectTitle, members }: { projectId: string; projectTitle: string; members: WorkspaceSettingsMember[] }) {
  const client = useQueryClient();
  const router = useRouter();
  const part = useQuery({ queryKey: partKey(projectId), queryFn: async () => unwrap(await getMyPartAction(projectId)), staleTime: 30_000 });
  const reach = useQuery({ queryKey: ["project", projectId, "my-agents"], queryFn: async () => unwrap(await readMyAgentsAndDevicesAction(projectId)), staleTime: 60_000 });
  // Member lists, pickers and this card follow changes made on other tabs and devices (report §7, gap 24).
  useMemberUpdates(projectId, () => { void client.invalidateQueries({ queryKey: partKey(projectId) }); });
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<null | "complete" | "leave" | "role">(null);

  const refresh = () => { void client.invalidateQueries({ queryKey: partKey(projectId) }); router.refresh(); };

  async function save(patch: MySettingsPatch, done = "Saved") {
    if (saving) return;
    setSaving(true);
    try {
      const next = unwrap(await updateMySettingsAction(projectId, patch));
      client.setQueryData(partKey(projectId), next);
      toast.success(done);
    } catch (error) {
      toast.error(feedbackError(error instanceof Error ? error.message : "", "Couldn’t save your settings"));
    } finally {
      setSaving(false);
    }
  }

  if (part.isPending) {
    return (
      <div role="status" aria-label="Loading your settings" className="space-y-8">
        {[0, 1, 2].map((i) => <Skeleton key={i} kind="tile" className="h-40 w-full" />)}
      </div>
    );
  }
  if (part.isError) {
    return (
      <p role="alert" className="nb-compact text-destructive">
        {part.error.message || "Couldn’t load your settings."}{" "}
        <button type="button" className="underline" onClick={() => void part.refetch()}>Retry</button>
      </p>
    );
  }
  const p = part.data;
  const completed = p.status === "completed";
  const rules = p.settings.notifications.rules ?? {};
  const mode: "all" | "mentions" | "off" | "custom" = p.settings.notifications.mode === "inherit" ? "all"
    : OVERRIDABLE.filter((e) => e.allowMemberOverride && !e.mandatory).every((e) => rules[e.key] === MENTION_KEYS.has(e.key)) ? "mentions"
    : OVERRIDABLE.filter((e) => e.allowMemberOverride && !e.mandatory).every((e) => rules[e.key] === false) ? "off" : "custom";
  const setMode = (next: "all" | "mentions" | "off") => {
    const r: Record<string, boolean> = {};
    for (const e of OVERRIDABLE) if (e.allowMemberOverride && !e.mandatory) r[e.key] = next === "mentions" ? MENTION_KEYS.has(e.key) : false;
    void save({ notifications: next === "all" ? { mode: "inherit" } : { mode: "custom", rules: r } }, "Notifications saved");
  };
  const muteUntil = p.settings.muteUntil;
  const muted = muteUntil === "forever" || (muteUntil && new Date(muteUntil).getTime() > Date.now());
  const muteFor = (days: number | "forever" | null) => void save({ muteUntil: days === null ? null : days === "forever" ? "forever" : new Date(Date.now() + days * 86_400_000).toISOString() }, days === null ? "Notifications back on here" : "Muted");
  const others = members.filter((m) => m.id && m.membershipRole !== "viewer" && !m.completion && m.username);

  return (
    <div className="space-y-8">
      <SettingsCard title="Your part here" description="Your role, your dates, and what your role can do.">
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
            <dt className="nb-compact text-muted-foreground">Role</dt>
            <dd className="nb-compact font-medium">{ROLE_WORD[p.role]}</dd>
            {p.joinedAt ? (<><dt className="nb-compact text-muted-foreground">Joined</dt><dd className="nb-compact">{day(p.joinedAt)}</dd></>) : null}
            <dt className="nb-compact text-muted-foreground">Status</dt>
            <dd className="nb-compact" data-my-part-status={p.status}>
              {completed && p.completion ? (
                <span className="space-y-1">
                  <span className="block font-medium">Completed · {day(p.completion.at)}</span>
                  {p.completion.note ? <span className="block text-muted-foreground">&ldquo;{p.completion.note}&rdquo;</span> : null}
                  {p.completion.byOwner && p.completion.by ? <span className="block text-muted-foreground">Marked completed by {p.completion.by.name}</span> : null}
                  {p.completion.confirmedBy ? <span className="block text-muted-foreground">Confirmed by {p.completion.confirmedBy.name}</span> : null}
                </span>
              ) : <span className="font-medium">Active</span>}
            </dd>
            <dt className="nb-compact text-muted-foreground">Owner</dt>
            <dd className="nb-compact">{p.owner?.name ?? "—"}{p.admins.length ? ` · Admins: ${p.admins.map((a) => a.name).join(", ")}` : ""}</dd>
          </dl>
          <p className="nb-compact text-muted-foreground">{p.canDo} <Link className="underline underline-offset-2" href="/docs/workspaces/your-part">How completing works</Link></p>
          {p.periods.length ? (
            <div className="space-y-1">
              <p className="nb-micro text-muted-foreground">Earlier here</p>
              <ul className="nb-compact space-y-0.5">
                {p.periods.map((x) => (
                  <li key={`${x.startedAt}-${x.endedAt}`}>{month(x.startedAt)} – {month(x.endedAt)} · {x.endReason === "left" ? "Left" : x.endReason === "removed" ? "Removed" : "Completed"}{x.note ? ` · “${x.note}”` : ""}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {p.canComplete ? <Button type="button" size="sm" onClick={() => setDialog("complete")}>Complete my part</Button> : null}
            {p.canReopen ? (
              <Button type="button" size="sm" disabled={saving} onClick={async () => {
                setSaving(true);
                const r = await reopenMyPartAction(projectId);
                setSaving(false);
                if (r.success) { toast.success("Your part is open again"); refresh(); } else toast.error(feedbackError(r.error, "Couldn’t reopen your part"));
              }}>Reopen my part</Button>
            ) : null}
            {!p.isOwner && !completed ? <Button type="button" size="sm" variant="outline" onClick={() => setDialog("role")}>Ask for a different role</Button> : null}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Notifications" description="What reaches you from this workspace. The workspace's required notices always come.">
        <div className="space-y-5">
          <fieldset className="space-y-2" disabled={saving}>
            <legend className="sr-only">Notifications here</legend>
            {([["all", "All", "Everything the workspace sends to members."], ["mentions", "Mentions and replies only", "Only when someone mentions you or replies to you."], ["off", "Off", "Nothing except required notices."]] as const).map(([value, label, help]) => (
              <label key={value} className="flex items-start gap-2.5">
                <input type="radio" className="nb-radio mt-0.5" name={`my-notify-${projectId}`} checked={mode === value} onChange={() => setMode(value)} />
                <span><span className="nb-compact block font-medium">{label}</span><span className="nb-compact block text-muted-foreground">{help}</span></span>
              </label>
            ))}
          </fieldset>
          <details className="border-t border-border pt-4">
            <summary className="nb-compact cursor-pointer font-medium">Choose each notice{mode === "custom" ? " · custom" : ""}</summary>
            <div className="mt-3 space-y-4">
              {WORKSPACE_NOTIFICATION_GROUPS.filter((g) => g.visible && OVERRIDABLE.some((e) => e.group === g.id)).map((g) => (
                <div key={g.id} className="space-y-2">
                  <p className="nb-micro text-muted-foreground">{g.title}</p>
                  {OVERRIDABLE.filter((e) => e.group === g.id).map((e) => {
                    const locked = e.mandatory || !e.allowMemberOverride;
                    const on = locked ? e.defaultEnabled || e.mandatory : (p.settings.notifications.mode === "inherit" ? e.defaultEnabled : rules[e.key] ?? e.defaultEnabled);
                    return (
                      <div key={e.key} className="flex items-start justify-between gap-6">
                        <div><p className="nb-compact">{e.label}</p>{locked ? <p className="nb-compact text-muted-foreground">{e.mandatory ? "Always on: this one is required." : "The owner decides this one."}</p> : null}</div>
                        <SettingsSwitch aria-label={e.label} checked={on} disabled={saving || locked}
                          onCheckedChange={(next: boolean) => {
                            const base: Record<string, boolean> = {};
                            for (const x of OVERRIDABLE) if (x.allowMemberOverride && !x.mandatory) base[x.key] = p.settings.notifications.mode === "inherit" ? x.defaultEnabled : rules[x.key] ?? x.defaultEnabled;
                            void save({ notifications: { mode: "custom", rules: { ...base, [e.key]: next } } }, "Notifications saved");
                          }} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="nb-compact mr-2">{muted ? (muteUntil === "forever" ? "Muted until you turn it back on" : `Muted until ${day(muteUntil!)}`) : "Mute this workspace"}</span>
            {muted ? <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => muteFor(null)}>Turn back on</Button> : (
              <>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => muteFor(1)}>For 1 day</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => muteFor(7)}>For 1 week</Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => muteFor("forever")}>Until I turn it back on</Button>
              </>
            )}
          </div>
        </div>
      </SettingsCard>

      {!p.isOwner ? (
        <SettingsCard title="How your work shows" description="Only stricter than the workspace's own setting.">
          <div className="space-y-4">
            {p.settings.membersChooseLabels ? (
              <Row id={`hide-label-${projectId}`} label="Hide “with Claude Code” on my work" help="Others here won’t see which agent helped on your work. You still do.">
                <SettingsSwitch id={`hide-label-${projectId}`} checked={p.settings.hideAgentLabel} disabled={saving} onCheckedChange={(v: boolean) => void save({ hideAgentLabel: v })} />
              </Row>
            ) : <p className="nb-compact text-muted-foreground">The owner decides who sees when agents helped here.</p>}
            <Row id={`show-profile-${projectId}`} label="Show this workspace on my profile" help="Your dates and role here on your public profile.">
              <SettingsSwitch id={`show-profile-${projectId}`} checked={p.settings.showOnProfile} disabled={saving} onCheckedChange={(v: boolean) => void save({ showOnProfile: v })} />
            </Row>
          </div>
        </SettingsCard>
      ) : null}

      <SettingsCard title="Your agents here" description="Agent sign-ins that can reach this workspace. They act as you.">
        <div className="space-y-4">
          <Row id={`agents-out-${projectId}`} label="Keep my agents out of this workspace" help="Every agent request here as you is refused, “all my workspaces” agents included. Your own CLI keeps working.">
            <SettingsSwitch id={`agents-out-${projectId}`} checked={p.settings.agentsBlocked} disabled={saving} onCheckedChange={(v: boolean) => void save({ agentsBlocked: v }, v ? "Your agents are kept out of here" : "Your agents can work here again")} />
          </Row>
          {reach.data?.agentsPaused ? <p className="nb-compact text-muted-foreground">The owner has paused all agents here.</p> : null}
          {reach.isPending ? <Skeleton kind="text" className="h-10 w-full" aria-label="Loading" /> : reach.data?.agents.length ? (
            <ul className="divide-y divide-border">
              {reach.data.agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-4 py-2">
                  <span><span className="nb-compact block font-medium">{a.name}</span><span className="nb-compact block text-muted-foreground">{a.sentence} · used {day(a.lastSeenAt)}</span></span>
                  <Button asChild size="sm" variant="outline"><Link href={`/settings/agents/${a.id}`}>Change access</Link></Button>
                </li>
              ))}
            </ul>
          ) : <p className="nb-compact text-muted-foreground">No agent sign-ins reach this workspace.</p>}
        </div>
      </SettingsCard>

      <SettingsCard title="Your devices" description="Your CLI and editor sign-ins. To unlink one folder, run nb unlink in it; your files stay.">
        {reach.isPending ? <Skeleton kind="text" className="h-10 w-full" aria-label="Loading" /> : reach.data?.devices.length ? (
          <ul className="divide-y divide-border">
            {reach.data.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 py-2">
                <span><span className="nb-compact block font-medium">{d.name}</span><span className="nb-compact block text-muted-foreground">Last used {day(d.lastSeenAt)}</span></span>
                <Button type="button" size="sm" variant="outline" onClick={async () => {
                  const r = await revokeExtensionSession(d.id);
                  if (r.success) { toast.success("Signed out on that device"); void reach.refetch(); } else toast.error(feedbackError(r.error, "Couldn’t sign out that device"));
                }}>Sign out</Button>
              </li>
            ))}
          </ul>
        ) : <p className="nb-compact text-muted-foreground">No CLI or editor is signed in.</p>}
      </SettingsCard>

      <SettingsCard title="Your view" description="How this workspace opens for you. Nobody else sees a change.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="nb-micro text-muted-foreground">Open on</span>
            <select className="nb-select w-full" value={p.settings.viewPrefs.defaultTab ?? ""} disabled={saving} onChange={(e) => void save({ viewPrefs: { defaultTab: e.target.value || null } })}>
              <option value="">The workspace’s first tab</option>
              {TABS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="nb-micro text-muted-foreground">Task cards</span>
            <select className="nb-select w-full" value={p.settings.viewPrefs.density ?? "comfortable"} disabled={saving} onChange={(e) => void save({ viewPrefs: { density: e.target.value as "compact" | "comfortable" } })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
      </SettingsCard>

      <SettingsCard title="Leave workspace" description="Leaving ends your membership. Your work stays, under your name.">
        {p.canLeave ? (
          <Button type="button" size="sm" variant="destructive" onClick={() => setDialog("leave")}>Leave {projectTitle}</Button>
        ) : (
          <p className="nb-compact text-muted-foreground">
            {p.leaveRefusal}{" "}
            {p.isOwner ? <Link className="underline" href="?tab=settings&settings=danger#project-settings-danger">Transfer ownership</Link> : null}
          </p>
        )}
      </SettingsCard>

      {dialog === "complete" || dialog === "leave" ? (
        <WrapUpDialog
          kind={dialog}
          projectId={projectId}
          projectTitle={projectTitle}
          people={others}
          lastAdmin={p.role === "admin" && p.admins.length <= 1}
          onClose={() => setDialog(null)}
          onDone={(undoId) => {
            setDialog(null);
            if (dialog === "complete") { offerUndo("Your part is completed", undoId, refresh); refresh(); }
            else { offerUndo(`You left ${projectTitle}`, undoId, () => router.push(`/workspaces/${p.workspace.slug ?? projectId}`)); router.push("/discover"); }
          }}
        />
      ) : null}
      {dialog === "role" ? <RoleRequestDialog projectId={projectId} current={p.role} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function Row({ id, label, help, children }: { id: string; label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="space-y-1"><label htmlFor={id} className="nb-compact font-medium">{label}</label><p className="nb-compact text-muted-foreground">{help}</p></div>
      {children}
    </div>
  );
}

/** Step 1, the wrap-up check (nothing changes), and step 2, confirm (report §3, §4). */
function WrapUpDialog({ kind, projectId, projectTitle, people, lastAdmin, onClose, onDone }: {
  kind: "complete" | "leave"; projectId: string; projectTitle: string; people: WorkspaceSettingsMember[]; lastAdmin: boolean;
  onClose: () => void; onDone: (undoId: string | null) => void;
}) {
  const wrap = useQuery({ queryKey: ["project", projectId, "wrap-up"], queryFn: async () => unwrap(await previewWrapUpAction(projectId)), staleTime: 0 });
  const [tasks, setTasks] = useState<TaskChoice>(kind === "leave" ? "unassign" : "keep");
  const [giveTo, setGiveTo] = useState(people[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const w: WrapUp | undefined = wrap.data;
  const open = w?.openTasks.count ?? 0;
  const consequence = open === 0 ? "" : tasks === "keep" ? ` ${open} open ${open === 1 ? "task stays" : "tasks stay"} assigned to you.` : tasks === "unassign" ? ` ${open} open ${open === 1 ? "task becomes" : "tasks become"} unassigned.` : ` ${open} open ${open === 1 ? "task goes" : "tasks go"} to ${people.find((x) => x.id === giveTo)?.fullName ?? "them"}.`;
  const needsName = kind === "leave" && lastAdmin;

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="wide"
      title={kind === "complete" ? `Complete your part in ${projectTitle}?` : `Leave ${projectTitle}?`}
      description={(kind === "complete" ? "You stay a member, read-only, and can reopen your part any time." : "Only a new invite brings you back.") + consequence}
      confirmLabel={kind === "complete" ? "Complete my part" : "Leave"}
      variant={kind === "leave" ? "destructive" : "default"}
      autoCloseOnConfirm={false}
      errorMessage={error ?? undefined}
      loading={wrap.isPending || (needsName && typed.trim() !== projectTitle.trim()) || (tasks === "give" && !giveTo)}
      onConfirm={async () => {
        setError(null);
        const input = { tasks, giveTo: tasks === "give" ? giveTo : null };
        const r = kind === "complete" ? await completeMyPartAction(projectId, { ...input, note: note.trim() || null }) : await leaveWorkspaceAction(projectId, input);
        if (!r.success) { setError(r.error); return; }
        onDone((r.data as { undoId?: string | null }).undoId ?? null);
      }}
    >
      {wrap.isPending ? <p role="status" className="nb-compact text-muted-foreground">Checking what’s still open…</p> : wrap.isError ? (
        <p role="alert" className="nb-compact text-destructive">{wrap.error.message}</p>
      ) : w ? (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="nb-compact font-medium">Open tasks assigned to you · {open}</legend>
            {w.openTasks.items.slice(0, 5).map((t) => <p key={t.id} className="nb-compact text-muted-foreground">#{t.number} {t.title}</p>)}
            {open > 5 ? <p className="nb-compact text-muted-foreground">and {open - 5} more</p> : null}
            {open > 0 ? (
              <div className="space-y-1.5">
                {(kind === "complete" ? (["keep", "give", "unassign"] as const) : (["unassign", "give"] as const)).map((c) => (
                  <label key={c} className="flex items-center gap-2.5">
                    <input type="radio" className="nb-radio" name="wrap-tasks" checked={tasks === c} onChange={() => setTasks(c)} />
                    <span className="nb-compact">{c === "keep" ? "Keep them assigned to me" : c === "unassign" ? "Unassign them" : "Give them to"}</span>
                    {c === "give" && tasks === "give" ? (
                      <select aria-label="Who gets your open tasks" className="nb-select" data-size="sm" value={giveTo} onChange={(e) => setGiveTo(e.target.value)}>
                        {people.map((x) => <option key={x.id} value={x.id}>{x.fullName || x.username}</option>)}
                      </select>
                    ) : null}
                  </label>
                ))}
                {kind === "complete" ? <p className="nb-compact text-muted-foreground">Open tasks don’t stop you completing.</p> : null}
              </div>
            ) : null}
          </fieldset>
          {w.reviews.count ? <p className="nb-compact">Reviews waiting on you · {w.reviews.count}: they go to the owner.</p> : null}
          {w.openWork.changeSets.length + w.openWork.branches.length + w.openWork.mergeRequests.length + w.openWork.docDrafts.length ? (
            <div className="space-y-1">
              <p className="nb-compact font-medium">Your open work stays as it is</p>
              <ul className="nb-compact space-y-0.5 text-muted-foreground">
                {w.openWork.changeSets.map((c) => <li key={c.id}>Change set: {c.title}</li>)}
                {w.openWork.branches.map((b) => <li key={b.id}>Branch: {b.name}</li>)}
                {w.openWork.mergeRequests.map((m) => <li key={m.number}>Merge request !{m.number} {m.title}</li>)}
                {w.openWork.docDrafts.map((d) => <li key={d.slug}>Doc draft: {d.filename}</li>)}
              </ul>
            </div>
          ) : null}
          <p className="nb-compact text-muted-foreground">{w.stays}</p>
          {kind === "complete" ? (
            <label className="block space-y-1">
              <span className="nb-micro text-muted-foreground">What I did (optional, shows on your profile)</span>
              <textarea className="nb-textarea min-h-[72px] w-full" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
              <span className="nb-meta block text-right text-muted-foreground">{note.length}/280</span>
            </label>
          ) : null}
          {needsName ? (
            <label className="block space-y-1">
              <span className="nb-micro text-muted-foreground">You’re the last admin. Type {projectTitle} to leave.</span>
              <input className="nb-input w-full" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          ) : null}
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

function RoleRequestDialog({ projectId, current, onClose }: { projectId: string; current: string; onClose: () => void }) {
  const choices = (["admin", "member", "viewer"] as const).filter((r) => r !== current);
  const [role, setRole] = useState<(typeof choices)[number]>(choices[0]!);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog open onOpenChange={(o) => { if (!o) onClose(); }} title="Ask for a different role" description="The owner and admins get your request with your note." confirmLabel="Send request" autoCloseOnConfirm={false} errorMessage={error ?? undefined}
      onConfirm={async () => {
        const r = await requestRoleAction(projectId, role, note.trim() || null);
        if (!r.success) { setError(r.error); return; }
        toast.success("Request sent to the owner");
        onClose();
      }}>
      <div className="space-y-3">
        <select aria-label="Role" className="nb-select w-full" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {choices.map((r) => <option key={r} value={r}>{ROLE_WORD[r]}</option>)}
        </select>
        <textarea aria-label="Why" className="nb-textarea min-h-[72px] w-full" maxLength={500} placeholder="Why (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

/**
 * The owner's "Complete this workspace" (report §3): every active member's part completes with today's date and the
 * note "Workspace completed". Setting it back to active reopens nobody; each person reopens their own part.
 */
export function CompleteWorkspaceCard({ projectId, status, title, onChanged }: { projectId: string; status: string | null | undefined; title: string; onChanged: () => void }) {
  const [ask, setAsk] = useState<null | "completed" | "active">(null);
  const [error, setError] = useState<string | null>(null);
  const completed = status === "completed";
  return (
    <SettingsCard title={completed ? "This workspace is completed" : "Complete this workspace"}
      description={completed ? "Everyone’s part was completed with it. Setting it back to active doesn’t reopen anyone; each person reopens their own part." : "When the work is finished: every member’s part completes today, and their profiles show it as Completed."}>
      <Button type="button" size="sm" variant="outline" onClick={() => { setError(null); setAsk(completed ? "active" : "completed"); }}>
        {completed ? "Set back to active" : "Complete this workspace"}
      </Button>
      {ask ? (
        <ConfirmDialog open onOpenChange={(o) => { if (!o) setAsk(null); }} autoCloseOnConfirm={false} errorMessage={error ?? undefined}
          title={ask === "completed" ? `Complete ${title}?` : `Set ${title} back to active?`}
          description={ask === "completed" ? "Every active member’s part completes now, with the note “Workspace completed”. They stay members, read-only, and can reopen their own part." : "Members stay completed until each reopens their own part."}
          confirmLabel={ask === "completed" ? "Complete the workspace" : "Set back to active"}
          onConfirm={async () => {
            try {
              await updateWorkspace(projectId, { status: ask } as never);
              toast.success(ask === "completed" ? "Workspace completed" : "Workspace is active again");
              setAsk(null);
              onChanged();
            } catch (e) {
              setError(feedbackError(e instanceof Error ? e.message : "", "Couldn’t change the workspace"));
            }
          }} />
      ) : null}
    </SettingsCard>
  );
}
