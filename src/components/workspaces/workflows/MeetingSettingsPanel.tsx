"use client";

import { useEffect, useState } from "react";

import { readMeetingSettingsAction, setMeetingSettingsAction } from "@/app/actions/meeting-settings";
import { SettingsRow } from "@/components/settings/ui/SettingsRow";
import { selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { MEETING_LENGTHS, MEETING_TYPES, REMINDER_MINUTES, type MeetingSettings } from "@/lib/workflows/meetings";

/**
 * Report 38.11 S8 and call 5 (A4.16): Settings → Workflows → Meetings: which meeting types New meeting offers (they
 * start from the workspace category), the default length and the reminder. Owners and admins change them; Blank stays on.
 */
export function MeetingSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<{ settings: MeetingSettings; canManage: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void readMeetingSettingsAction(workspaceId).then((r) => { if (live && r.success) setState({ settings: r.settings, canManage: r.canManage }); });
    return () => { live = false; };
  }, [workspaceId]);
  if (!state) return <div aria-hidden="true" className="nb-skeleton h-24 rounded-[8px]" />;
  const { settings, canManage } = state;
  async function save(next: MeetingSettings) {
    const before = state!.settings;
    setState({ settings: next, canManage });
    setBusy(true);
    try {
      const r = await setMeetingSettingsAction(workspaceId, next);
      if (!r.success) throw new Error(r.error);
    } catch (e) {
      setState({ settings: before, canManage });
      toast.error(e instanceof Error ? e.message : "Couldn’t save the meeting settings.");
    } finally {
      setBusy(false);
    }
  }
  const toggle = (id: string, on: boolean) => void save({ ...settings, types: MEETING_TYPES.map((t) => t.id).filter((t) => (t === id ? on : settings.types.includes(t))) });
  return (
    <div className="space-y-3 rounded-[8px] border border-border p-4" data-testid="meeting-settings">
      <h3 className="nb-ui-label text-foreground">Meetings</h3>
      <fieldset className="space-y-1.5">
        <legend className="text-[13px] font-medium">Meeting types in New meeting</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {MEETING_TYPES.map((t) => (
            <label key={t.id} className="flex min-h-8 items-center gap-2 text-[13px]">
              <input type="checkbox" checked={settings.types.includes(t.id)} disabled={!canManage || busy || t.id === "blank"} onChange={(e) => toggle(t.id, e.target.checked)} />
              {t.name}{t.id === "blank" ? <span className="text-[12px] text-muted-foreground">· always on</span> : null}
            </label>
          ))}
        </div>
      </fieldset>
      <SettingsRow title="Default length" description="New meetings start with this length."
        right={<SelectWrap><select aria-label="Default length" className={selectClassName()} disabled={!canManage || busy} value={settings.lengthMinutes} onChange={(e) => void save({ ...settings, lengthMinutes: Number(e.target.value) })}>
          {MEETING_LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </select></SelectWrap>} />
      <SettingsRow title="Reminder" description="Attendees get it before each meeting starts."
        right={<SelectWrap><select aria-label="Reminder" className={selectClassName()} disabled={!canManage || busy} value={settings.reminderMinutes} onChange={(e) => void save({ ...settings, reminderMinutes: Number(e.target.value) })}>
          {REMINDER_MINUTES.map((m) => <option key={m} value={m}>{m === 0 ? "Off" : `${m} minutes before`}</option>)}
        </select></SelectWrap>} />
    </div>
  );
}
