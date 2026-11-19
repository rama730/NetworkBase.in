"use client";

import { Lock, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { catalogEntry, type CatalogEntry } from "@/lib/workflows/catalog";
import { AddWorkflowDialog, RemoveWorkflowDialog } from "./AddWorkflowDialog";
import { useWorkspaceWorkflows } from "./useWorkspaceWorkflows";
import { workflowIcon } from "./workflow-icons";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null);

/** Report 38.2 S8: Settings → Workflows, after "Stages and workflow". Shown only when the workspace's switch is on. */
export function WorkflowSettingsSection({ workspaceId }: { workspaceId: string }) {
  const workflows = useWorkspaceWorkflows(workspaceId, null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CatalogEntry | null>(null);
  const { refresh } = workflows;
  useEffect(() => { void refresh(); }, [refresh]);
  if (!workflows.enabled) return null;

  return (
    <section id="project-settings-workflows" data-project-settings-section className="space-y-4">
      <SettingsPageHeader level={2} title="Workflows" description="Workflows add views, stages or tabs. Everyone in the workspace uses them." />
      <div className="flex justify-end">
        {workflows.canManage ? (
          <button type="button" className={`${FORM_SECONDARY_CLASS} inline-flex items-center gap-1.5`} onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="size-4" />Add workflow
          </button>
        ) : null}
      </div>
      {workflows.added.length === 0 ? (
        <EmptyState icon={Plus} title="No workflows added" description="Add one to give this workspace a Bugs tab, a Projects view or document sections." />
      ) : (
        <div className="divide-y divide-border">
          {workflows.added.map((w) => {
            const entry = catalogEntry(w.workflow);
            if (!entry) return null;
            const Icon = workflowIcon(entry.icon);
            return (
              <div key={w.workflow} className="flex items-center gap-3">
                <Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                <SettingsRow
                  className="flex-1"
                  title={entry.name}
                  description={w.locked ? `Added by ${w.by ?? "the organization"}` : [entry.line, [w.addedBy && `Added by ${w.addedBy}`, day(w.addedAt)].filter(Boolean).join(" · ")].filter(Boolean).join(" ")}
                  right={w.locked ? (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={`Only ${w.by ?? "the organization"} can remove it`}><Lock aria-hidden="true" className="size-3" />Locked</span>
                  ) : workflows.canManage ? (
                    <button type="button" className="nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline" onClick={() => setRemoving(entry)}>
                      Remove<span className="sr-only"> {entry.name}</span>
                    </button>
                  ) : null}
                />
              </div>
            );
          })}
        </div>
      )}
      <AddWorkflowDialog open={adding} onOpenChange={setAdding} workspaceId={workspaceId} added={workflows.added} canManage={workflows.canManage} onChanged={() => void workflows.refresh()} />
      <RemoveWorkflowDialog entry={removing} workspaceId={workspaceId} onClose={() => setRemoving(null)} onChanged={() => void workflows.refresh()} />
    </section>
  );
}
