"use client";

import { useQuery } from "@tanstack/react-query";

import { listMyOrganizationsAction } from "@/app/actions/organizations";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { DEFAULT_ORG_NOTIFICATION_CHOICE } from "@/lib/notifications/preferences";
import type { NotificationPreferences, OrgNotificationChoice } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const LEVELS: Array<{ value: OrgNotificationChoice["level"]; label: string }> = [
  { value: "all", label: "All" },
  { value: "important", label: "Important only" },
  { value: "off", label: "Off" },
];

/**
 * Settings › Notifications › Organizations (report §26.8): per org All / Important only / Off, Email, and
 * Include its workspaces. Off still keeps the emails about your access (removal, ownership, deletion).
 */
export function OrgNotificationChoices({ preferences, disabled, onSave }: { preferences: NotificationPreferences; disabled: boolean; onSave: (next: NotificationPreferences) => void }) {
  const { data: orgs = [] } = useQuery({ queryKey: ["my-organizations"], queryFn: () => listMyOrganizationsAction(), staleTime: 60_000 });
  if (orgs.length === 0) return null;
  const set = (orgId: string, patch: Partial<OrgNotificationChoice>) => onSave({
    ...preferences,
    organizations: { ...preferences.organizations, [orgId]: { ...DEFAULT_ORG_NOTIFICATION_CHOICE, ...preferences.organizations[orgId], ...patch } },
  });
  return (
    <SettingsSectionCard title="Organizations" description="How much each organization reaches you. Off still sends emails about your access, like removal or ownership.">
      <div className="divide-y divide-border">
        {orgs.map((org) => {
          const choice = preferences.organizations[org.id] ?? DEFAULT_ORG_NOTIFICATION_CHOICE;
          return (
            <div key={org.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 truncate text-sm font-medium text-foreground">{org.title}</p>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <div role="radiogroup" aria-label={`${org.title} notifications`} className="inline-flex overflow-hidden rounded-[5px] border border-border">
                  {LEVELS.map((level) => (
                    <button key={level.value} type="button" role="radio" aria-checked={choice.level === level.value} disabled={disabled}
                      onClick={() => set(org.id, { level: level.value })}
                      className={cn("min-h-8 px-2.5 text-[12px]", choice.level === level.value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
                      {level.label}
                    </button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={choice.email} disabled={disabled} onChange={(e) => set(org.id, { email: e.target.checked })} /> Email
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={choice.includeChildren} disabled={disabled} onChange={(e) => set(org.id, { includeChildren: e.target.checked })} /> Include its workspaces
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSectionCard>
  );
}
