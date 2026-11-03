"use client";
import { useEffect, useState } from "react";
import { ItemMenu } from "@/components/reports/ItemMenu";
import { EyeOff, FolderGit2, Pencil, Plus } from "lucide-react";
import { Card } from "./Card";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import { ContributionStoryView } from "@/components/profile/ContributionStoryView";
import { dismissContributionNudgeAction } from "@/app/actions/org-profile";
import { entryStatus, groupProfileContributions } from "@/lib/organizations/profile-rules";
import { profileEditHref } from "@/lib/profile/edit-route";

/** Org context above an entry (report §24.5, §24.6): Verified by <org>, the child's org, org-only, revocation. */
function OrgEntryLine({ c, isOwner, nested }: { c: ProfileCollaborationContribution; isOwner: boolean; nested?: boolean }) {
  const parts: string[] = [];
  if (c.goneOrgTitle) parts.push("Organization no longer on NetworkBase");
  else if (c.projectKind === "organization") parts.push(c.orgVerified ? `✓ Verified by ${c.projectTitle}` : "Organization");
  else if (c.parentOrg && !nested) parts.push(`Workspace of ${c.parentOrg.title}`);
  else if (c.formerOrg) parts.push(`with ${c.formerOrg.title} (until ${c.formerOrg.until})`);
  if (c.orgOnly && c.parentOrg && !c.projectHref) parts.push(`Visible to ${c.parentOrg.title} members`);
  if (isOwner && c.verificationRevokedReason) parts.push(`Verification removed: ${c.verificationRevokedReason}`);
  return parts.length ? <p className="nb-compact pt-4 text-muted-foreground">{parts.join(" · ")}</p> : null;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border last:border-b-0">
      <h3 className="nb-micro pt-4 text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

interface ProjectContributionsCardProps {
  contributions: ProfileCollaborationContribution[];
  isOwner: boolean;
  profileId?: string;
  onAdd?: () => void;
  projects?: Array<{ id?: string; title?: string; url?: string }>;
  onProjectIntent?: (href: string) => void;
}
export function WorkspaceContributionsCard({
  contributions,
  isOwner,
  profileId,
  onAdd,
  onProjectIntent,
}: ProjectContributionsCardProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(contributions),
    [showAll, setShowAll] = useState(false);
  useEffect(() => setLive(contributions), [contributions]);
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/v1/profiles/${encodeURIComponent(profileId)}/contributions?limit=50&stageLimit=20`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          if (!cancelled && [403, 404].includes(response.status)) setLive([]);
          return;
        }
        const body = await response.json();
        if (!cancelled && body.data?.contributions)
          setLive(body.data.contributions);
      } catch {
        /* Keep the currently rendered story; no speculative content replacement. */
      }
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus);
    };
  }, [profileId, isOwner]);
  const visible = live
    .filter((c) => isOwner || c.visibility === "public")
    .sort((a, b) => {
      if (Number(b.featured) !== Number(a.featured)) {
        return Number(b.featured) - Number(a.featured);
      }
      const dateA = a.startDate || a.createdAt || "";
      const dateB = b.startDate || b.createdAt || "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const createdA = a.projectCreatedAt || a.createdAt || "";
      const createdB = b.projectCreatedAt || b.createdAt || "";
      if (createdA !== createdB) return createdB.localeCompare(createdA);
      return b.id.localeCompare(a.id);
    });
  if (!isOwner && !visible.length) return null;
  const groups = groupProfileContributions(visible, isOwner);
  const shownCount = groups.organizations.length + groups.workspaces.length;
  let index = 0;
  const entry = (c: (typeof groups.organizations)[number]) => {
    const position = index++;
    const status = entryStatus(c);
    return (
      <div key={c.id + ":" + JSON.stringify(c.presentation)} className={!showAll && position >= 2 ? "max-md:hidden" : ""}>
        {isOwner && c.visibility === "private" && (
          <p className="nb-compact pt-4 text-muted-foreground" title="Only you can see this contribution">
            <EyeOff className="mr-1 inline size-3.5" />
            Private · only you can see this contribution
          </p>
        )}
        <OrgEntryLine c={c} isOwner={isOwner} />
        {status ? <p className="nb-compact pt-1 text-muted-foreground" data-testid="entry-status">{status}{c.endDate ? ` ${c.endDate}` : ""}</p> : null}
        {/* Report a contribution story (C15); not on your own profile. */}
        {!isOwner ? <div className="flex justify-end pt-3"><ItemMenu label="Contribution actions" report={{ kind: "contribution", targetId: c.id, noun: "contribution story" }} /></div> : null}
        <ContributionStoryView contribution={{ ...c, draftStory: null }} onProjectIntent={onProjectIntent} />
        {c.children.length ? (
          <div className="mb-4 ml-4 border-l border-border pl-4" aria-label={`Workspaces in ${c.projectTitle}`}>
            {c.children.map((child) => (
              <div key={child.id}>
                <OrgEntryLine c={child} isOwner={isOwner} nested />
                <ContributionStoryView contribution={{ ...child, draftStory: null }} onProjectIntent={onProjectIntent} />
              </div>
            ))}
          </div>
        ) : null}
        {c.workRecord ? (
          <p className="nb-compact mb-4 text-muted-foreground" data-testid="work-record">
            Work record: {c.workRecord.done} of {c.workRecord.total} assignments · {c.workRecord.sprints} {c.workRecord.sprints === 1 ? "sprint" : "sprints"}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <Card
      title="Contributions"
      onAdd={onAdd}
      addLabel="Add contribution"
      action={
        isOwner && onAdd ? (
          <button
            type="button"
            aria-label="Edit workspace contributions"
            onClick={onAdd}
            className="nb-touch-target rounded-[3px] p-1.5 text-muted-foreground hover:bg-muted"
          >
            <Pencil className="size-4" />
          </button>
        ) : null
      }
    >
      <div className="px-5 max-md:px-4">
        {visible.length ? (
          <div>
            {/* Report §4.5, §16.9: organizations (with their workspaces nested), then workspaces; your own view adds
                drafts and removed entries, so a draft can't be mistaken for a public entry. */}
            {groups.organizations.length ? <Group title="Organizations">{groups.organizations.map((c) => entry(c))}</Group> : null}
            {groups.workspaces.length ? <Group title="Workspaces">{groups.workspaces.map((c) => entry(c))}</Group> : null}
            {groups.drafts.length ? (
              <Group title="Not on your profile yet">
                {groups.drafts.flatMap((d) => [d, ...d.children]).map((c) => {
                  // Report §38.6, decision 107: the nudge shows once and goes for good when dismissed or published.
                  const nudge = (c.projectKind === "organization" || c.parentOrg) && !c.nudgeDismissed && !dismissed.has(c.id);
                  const nested = Boolean(c.parentOrg && groups.drafts.some((d) => d.projectId === c.parentOrg!.id));
                  return (
                    <div key={c.id} className={`flex flex-wrap items-center gap-2 py-3 text-sm ${nested ? "pl-5" : ""}`}>
                      <span className="min-w-0 flex-1"><span className="font-medium">{c.projectTitle}</span><span className="text-muted-foreground"> · Draft</span></span>
                      {/* Live-fix 54, 55: the nudge names this entry's own workspace, and Publish sits beside it; both open the entry. */}
                      {onAdd && nudge ? <a href={profileEditHref("experience", "overview", { contribution: c.id })} className="nb-ui-label text-primary">{`Write about your work in ${c.projectTitle}`}</a> : null}
                      {onAdd ? <a href={profileEditHref("experience", "overview", { contribution: c.id })} className="nb-ui-label text-primary">Publish</a> : null}
                      {nudge ? <button type="button" onClick={() => { setDismissed((d) => new Set(d).add(c.id)); void dismissContributionNudgeAction(c.id); }} className="nb-ui-label text-muted-foreground hover:text-foreground">Dismiss</button> : null}
                    </div>
                  );
                })}
              </Group>
            ) : null}
            {groups.privateToYou.length ? (
              <Group title="Private to you">
                {groups.privateToYou.map((c) => (
                  <div key={c.id} className="py-3 text-sm">
                    <p><span className="font-medium">{c.projectTitle}</span><span className="text-muted-foreground"> · Removed{c.endDate ? ` ${c.endDate}` : ""}</span></p>
                    <p className="nb-compact text-muted-foreground"><EyeOff className="mr-1 inline size-3.5" />Only you can see this. Your words are kept, and you can delete them in Edit.</p>
                  </div>
                ))}
              </Group>
            ) : null}
            {!showAll && shownCount > 2 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="nb-touch-target w-full py-3 nb-ui-label text-primary md:hidden"
              >
                Show all {shownCount}
              </button>
            )}
          </div>
        ) : (
          <div className="nb-empty-state nb-grid-ground py-8 text-center">
            <FolderGit2 className="nb-empty-state-icon mb-2" />
            <p className="nb-card-title">No workspace contributions</p>
            <p className="nb-compact mt-1 text-muted-foreground">
              {isOwner
                ? "Add your external projects or contribute to workspaces on NetworkBase."
                : "No public workspace contributions yet."}
            </p>
            {isOwner && onAdd && (
              <button
                type="button"
                onClick={onAdd}
                className="nb-touch-target mt-3 inline-flex items-center gap-1 nb-ui-label text-primary"
              >
                <Plus className="size-4" />
                Add contribution
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
