"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { readRoleAbilitiesAction, updateRoleAbilitiesAction } from "@/app/actions/workspace/role-abilities";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsCard } from "@/components/workspaces/settings/SettingsFormFields";
import { feedbackError, toast } from "@/lib/feedback";
import { ROLE_ABILITIES, abilityEditable, roleAllows, type AbilityRole, type RoleAbilities } from "@/lib/workspaces/role-abilities";

const ROLES: Array<[AbilityRole, string]> = [["admin", "Admin"], ["member", "Member"], ["viewer", "Viewer"]];
const key = (id: string) => ["project", id, "role-abilities"] as const;

/** Settings → Roles (member settings Part 4): one row per ability, a column per role. Defaults are today's rules. */
export function RoleAbilitiesSection({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const data = useQuery({
    queryKey: key(projectId),
    staleTime: 30_000,
    queryFn: async () => {
      const r = await readRoleAbilitiesAction(projectId);
      if (!r.success) throw new Error(r.error);
      return r;
    },
  });
  const [saving, setSaving] = useState(false);

  async function save(next: RoleAbilities | null, done: string) {
    setSaving(true);
    const r = await updateRoleAbilitiesAction(projectId, next);
    setSaving(false);
    if (!r.success) { toast.error(feedbackError(r.error, "Couldn’t save the roles")); return; }
    client.setQueryData(key(projectId), (old: typeof data.data) => (old ? { ...old, abilities: r.abilities } : old));
    toast.success(done);
  }

  if (data.isPending) return <Skeleton kind="tile" className="h-72 w-full" aria-label="Loading roles" />;
  if (data.isError) {
    return (
      <p role="alert" className="nb-compact text-destructive">
        {data.error.message}{" "}<button type="button" className="underline" onClick={() => void data.refetch()}>Retry</button>
      </p>
    );
  }
  const { abilities, canChange, orgRules } = data.data;
  const changed = Boolean(abilities);

  return (
    <SettingsCard title="What each role can do"
      description={orgRules ? "Your organization’s permission table decides this here. This is how it reads today." : "The owner can do everything. Viewers only read and comment, so their write abilities stay off. Changes apply at once, in the app, the CLI and for agents."}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="nb-micro py-2 pr-4 text-muted-foreground">Ability</th>
              {ROLES.map(([, label]) => <th key={label} scope="col" className="nb-micro px-2 py-2 text-center text-muted-foreground">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROLE_ABILITIES.map((a) => (
              <tr key={a.key} className="border-b border-border/60">
                <th scope="row" className="py-2.5 pr-4 font-normal">
                  <span className="nb-compact block font-medium">{a.label}</span>
                  <span className="nb-compact block text-muted-foreground">{a.help}</span>
                </th>
                {ROLES.map(([role, label]) => {
                  const on = roleAllows(abilities, role, a.key, { orgRules });
                  const editable = canChange && abilityEditable(role, a.key);
                  return (
                    <td key={role} className="px-2 py-2.5 text-center">
                      <input type="checkbox" className="nb-check" aria-label={`${label}: ${a.label}`} checked={on} disabled={saving || !editable}
                        title={!abilityEditable(role, a.key) ? "Viewers only read and comment" : undefined}
                        onChange={(e) => {
                          const next: RoleAbilities = JSON.parse(JSON.stringify(abilities ?? {}));
                          (next[role] ??= {})[a.key] = e.target.checked;
                          void save(next, `${label}s ${e.target.checked ? "can" : "can’t"} ${a.label.toLowerCase()} now`);
                        }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canChange && changed ? (
        <Button type="button" size="sm" variant="outline" className="mt-4" disabled={saving} onClick={() => void save(null, "Back to the default rules")}>Back to the default rules</Button>
      ) : null}
    </SettingsCard>
  );
}
