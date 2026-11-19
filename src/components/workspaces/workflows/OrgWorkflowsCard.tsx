"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { orgPushCountsAction, pushWorkflowAction, readOrgWorkflowsAction, unpushWorkflowAction } from "@/app/actions/workflows";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { WORKFLOW_CATALOG, type CatalogEntry } from "@/lib/workflows/catalog";
import type { OrgWorkflows } from "@/lib/workflows/rules";

const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const plural = (n: number) => `${n} ${n === 1 ? "workspace" : "workspaces"}`;

/**
 * Report 38.2 S10, W8: Settings → Workflows for workspaces. The organization adds a workflow to every workspace inside
 * it; they can't remove it. Removing it shows the totals across them first; workspaces that added it themselves keep it.
 */
export function OrgWorkflowsCard({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [state, setState] = useState<OrgWorkflows | null>(null);
  const [pushing, setPushing] = useState<CatalogEntry | null>(null);
  const [removing, setRemoving] = useState<CatalogEntry | null>(null);
  const [counts, setCounts] = useState<{ total: number; open: number; onBoard: number } | null>(null);
  // The dialogs keep naming the last workflow while they fade out (it read "Add undefined…" during the close).
  const lastPush = useRef<CatalogEntry | null>(null);
  const lastRemove = useRef<CatalogEntry | null>(null);
  if (pushing) lastPush.current = pushing;
  if (removing) lastRemove.current = removing;
  const toPush = pushing ?? lastPush.current;
  const toRemove = removing ?? lastRemove.current;
  const refresh = useCallback(async () => {
    const result = await readOrgWorkflowsAction(orgId);
    if (result.success) setState(result);
  }, [orgId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!removing) return;
    let current = true;
    setCounts(null);
    void orgPushCountsAction({ orgId, workflow: removing.id }).then((r) => { if (current && r.success) setCounts(r); });
    return () => { current = false; };
  }, [orgId, removing]);

  if (!state?.enabled) return null;
  const built = WORKFLOW_CATALOG.filter((w) => w.built);
  const isPushed = (id: string) => state.rows.some((r) => r.workflow === id && r.pushed);

  async function push(entry: CatalogEntry) {
    const result = await pushWorkflowAction({ orgId, workflow: entry.id });
    if (!result.success) throw new Error(result.error);
    toast(`${entry.name} added to ${plural(result.workspaces)}`);
    await refresh();
  }
  async function unpush(entry: CatalogEntry) {
    const result = await unpushWorkflowAction({ orgId, workflow: entry.id });
    if (!result.success) throw new Error(result.error);
    toast(`${entry.name} removed from the workspaces`);
    await refresh();
  }

  return (
    <section id="project-settings-org-workflows" data-project-settings-section className="space-y-6">
      <SettingsCard title="Workflows for workspaces" headingLevel={2} description="Add a workflow to every workspace in the organization. They can’t remove it.">
        {built.length === 0 ? (
          <p className="nb-compact text-muted-foreground" data-testid="org-workflows-none">No workflow is ready yet. They arrive here as each one is built.</p>
        ) : (
          <div className="divide-y divide-border">
            {built.map((entry) => (
              <SettingsRow key={entry.id} title={entry.name} description={entry.line}
                meta={isPushed(entry.id) ? `Pushed to ${plural(state.workspaces)}` : undefined}
                right={isPushed(entry.id)
                  ? <button type="button" className={LINK} onClick={() => setRemoving(entry)}>Remove from workspaces<span className="sr-only"> {entry.name}</span></button>
                  : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setPushing(entry)}>Add to every workspace<span className="sr-only"> {entry.name}</span></button>} />
            ))}
          </div>
        )}
      </SettingsCard>
      <ConfirmDialog open={Boolean(pushing)} onOpenChange={(open) => { if (!open) setPushing(null); }}
        title={`Add ${toPush?.name ?? ""} to every workspace?`}
        description={`Adds ${toPush?.name ?? ""} to ${plural(state.workspaces)} in ${orgName}. They can’t remove it.`}
        confirmLabel={`Add to ${plural(state.workspaces)}`} onConfirm={() => (pushing ? push(pushing) : undefined)} />
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }}
        title={`Remove ${toRemove?.name ?? ""} from the workspaces?`}
        description={`${counts ? `${counts.total} ${toRemove?.types.length ? toRemove.name.toLowerCase() : "items"} · ${counts.open} open · ${counts.onBoard} on the board across ${plural(state.workspaces)}. ` : ""}It leaves workspaces that didn’t add it themselves. Nothing is deleted.`}
        confirmLabel={`Remove ${toRemove?.name ?? ""}`} onConfirm={() => (removing ? unpush(removing) : undefined)} />
    </section>
  );
}
