"use client";

import { useQuery } from "@tanstack/react-query";

import { listMyOrganizationsAction } from "@/app/actions/organizations";
import { SegChoice } from "@/components/settings/mix/parts";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { DEFAULT_ORG_NOTIFICATION_CHOICE } from "@/lib/notifications/preferences";
import type { NotificationPreferences, OrgNotificationChoice } from "@/lib/notifications/types";

const LEVELS: Array<{ value: OrgNotificationChoice["level"]; label: string }> = [
  { value: "all", label: "All" },
  { value: "important", label: "Important only" },
  { value: "off", label: "Off" },
];

/**
 * Settings › Notifications › Organizations (report §26.8; settings mix): per org All / Important only / Off as
 * segmented cells, with Email and Include its workspaces. Off still keeps the emails about your access.
 */
export function OrgNotificationChoices({ preferences, disabled, onSave }: { preferences: NotificationPreferences; disabled: boolean; onSave: (next: NotificationPreferences) => void }) {
  const { data: orgs = [] } = useQuery({ queryKey: ["my-organizations"], queryFn: () => listMyOrganizationsAction(), staleTime: 60_000 });
  if (orgs.length === 0) return null;
  const set = (orgId: string, patch: Partial<OrgNotificationChoice>) => onSave({
    ...preferences,
    organizations: { ...preferences.organizations, [orgId]: { ...DEFAULT_ORG_NOTIFICATION_CHOICE, ...preferences.organizations[orgId], ...patch } },
  });
  return (
    <SettingsSectionCard id="settings-notifications-orgs" title="Organizations" flush findKeys="organization org class team">
      <SettingsRows>
        {orgs.map((org) => {
          const choice = preferences.organizations[org.id] ?? DEFAULT_ORG_NOTIFICATION_CHOICE;
          return (
            <SettingsRow
              key={org.id}
              title={org.title}
              description={<span className="inline-flex flex-wrap gap-x-4 gap-y-1">
                <label className="inline-flex items-center gap-1.5"><input className="nbs-cbx" type="checkbox" checked={choice.email} disabled={disabled} onChange={(e) => set(org.id, { email: e.target.checked })} /> Email</label>
                <label className="inline-flex items-center gap-1.5"><input className="nbs-cbx" type="checkbox" checked={choice.includeChildren} disabled={disabled} onChange={(e) => set(org.id, { includeChildren: e.target.checked })} /> Include its workspaces</label>
              </span>}
              right={<SegChoice label={`${org.title} notifications`} value={choice.level} options={LEVELS} busy={disabled} onChange={(level) => set(org.id, { level })} />}
            />
          );
        })}
      </SettingsRows>
      <p className="nbs-foot">Off still sends emails about your access, like removal or ownership.</p>
    </SettingsSectionCard>
  );
}
