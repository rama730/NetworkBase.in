"use client";

import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { orgPushedWorkflowsAction } from "@/app/actions/workflows";
import { SectionDivider } from "@/components/workspaces/v2/tasks/form-parts";
import { catalogEntry, suggestedWorkflows } from "@/lib/workflows/catalog";
import type { CreateWorkspaceInput } from "@/lib/validations/workspace";
import { workflowIcon } from "./workflow-icons";

/**
 * Report 38.2 W9, S9: the wizard's Workflows block under Journey stages. The category's built suggestions with only
 * the first ticked (decision 5), and, inside an organization, what it pushes as locked rows "Set by …". Renders
 * nothing until there's something to show.
 */
export function WizardWorkflowsField({ orgId }: { orgId: string | null }) {
  const { control, setValue, getFieldState } = useFormContext<CreateWorkspaceInput>();
  const category = useWatch({ control, name: "project_type" });
  const picked = useWatch({ control, name: "workflows" }) ?? [];
  const [pushed, setPushed] = useState<{ by: string | null; workflows: string[] }>({ by: null, workflows: [] });
  const suggestions = suggestedWorkflows(category).filter((s) => !pushed.workflows.includes(s.workflow));

  useEffect(() => {
    if (!orgId) return;
    let current = true;
    void orgPushedWorkflowsAction(orgId).then((r) => { if (current && r.success) setPushed({ by: r.by, workflows: r.workflows }); });
    return () => { current = false; };
  }, [orgId]);

  // A new category brings its own first suggestion, unless the person already chose.
  useEffect(() => {
    if (getFieldState("workflows").isDirty) return;
    setValue("workflows", suggestedWorkflows(category).filter((s) => s.ticked).map((s) => s.workflow));
  }, [category, getFieldState, setValue]);

  const rows = [...pushed.workflows.filter((id) => catalogEntry(id)).map((id) => ({ id, locked: true })), ...suggestions.map((s) => ({ id: s.workflow, locked: false }))];
  if (!rows.length) return null;
  const toggle = (id: string, on: boolean) => setValue("workflows", on ? [...picked, id] : picked.filter((w) => w !== id), { shouldDirty: true });

  return (
    <div className="mt-6 space-y-2" data-testid="wizard-workflows">
      <SectionDivider title="Workflows" />
      <p className="text-xs text-muted-foreground">Suggested for this category. Add more later from + Add workflow.</p>
      <ul className="divide-y divide-border">
        {rows.map(({ id, locked }) => {
          const entry = catalogEntry(id)!;
          const Icon = workflowIcon(entry.icon);
          return (
            <li key={id}>
              <label className="flex min-h-11 items-center gap-3 py-2">
                <input type="checkbox" className="nb-check" checked={locked || picked.includes(id)} disabled={locked} onChange={(e) => toggle(id, e.target.checked)} />
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="nb-ui-label block text-foreground">{entry.name}</span>
                  <span className="block text-xs text-muted-foreground">{locked ? `Set by ${pushed.by ?? "the organization"}` : entry.line}</span>
                </span>
                {locked ? <Lock aria-label={`Set by ${pushed.by ?? "the organization"}`} className="size-3.5 text-muted-foreground" /> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
