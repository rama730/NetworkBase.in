"use client";
import { CharCount } from "@/components/ui/CharCount";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";

import { useEffect, useState } from "react";
import { X } from "@/components/ui/icons";
import { toast } from "@/lib/feedback";

import { clearMyStatus, setMyStatus, setShowActivity, setStatusVisibility } from "@/app/actions/presence";
import { PRESENCE_VISIBILITY_EVENT } from "@/lib/presence/events";
import { EmojiChoice } from "@/components/presence/EmojiChoice";
import { usePresenceUi } from "@/components/presence/presence-ui-store";
import { useMyPresenceSettings, useRefreshPresence } from "@/components/presence/useMyPresence";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  STATUS_SUGGESTIONS,
  STATUS_TEXT_MAX,
  clearAfterToDate,
  type ClearAfter,
  type StatusSuggestion,
  type StatusVisibility,
} from "@/lib/presence/model";

const CLEAR_AFTER: Array<{ value: ClearAfter; label: string }> = [
  { value: "never", label: "Don’t clear" },
  { value: "30m", label: "30 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "4h", label: "4 hours" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "custom", label: "Choose date and time" },
];

const DURATION_HINT: Record<ClearAfter, string> = { never: "", "30m": "30 minutes", "1h": "1 hour", "4h": "4 hours", today: "Today", week: "This week", custom: "Choose dates" };

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return <SettingsSwitch checked={checked} onCheckedChange={onChange} aria-label={label} />;
}

/** "Set a status": any emoji + your words (Slack style), suggestions, when it clears, pausing notifications, and who sees it. */
export function StatusPicker() {
  const open = usePresenceUi((state) => state.pickerOpen);
  const setOpen = usePresenceUi((state) => state.setPickerOpen);
  const settings = useMyPresenceSettings(open);
  const refresh = useRefreshPresence();
  const [emoji, setEmoji] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [clearAfter, setClearAfter] = useState<ClearAfter>("today");
  const [until, setUntil] = useState("");
  const [pause, setPause] = useState(false);
  const [showActivity, setShowActivityState] = useState(true);
  const [visibility, setVisibility] = useState<StatusVisibility>("network");
  const [saving, setSaving] = useState(false);

  const draftText = usePresenceUi((state) => state.draftText);
  // Load the current status each time the picker opens (or the text typed after /status).
  useEffect(() => {
    if (!open || !settings.data) return;
    const current = settings.data.status;
    setEmoji(draftText ? null : current?.emoji ?? null);
    setText(draftText ?? current?.text ?? "");
    setClearAfter(current ? (current.expiresAt ? "custom" : "never") : "today");
    setUntil(current?.expiresAt ? toLocalInput(new Date(current.expiresAt)) : "");
    setPause(current?.pausesNotifications ?? false);
    setShowActivityState(settings.data.showActivity);
    setVisibility(settings.data.visibility);
  }, [draftText, open, settings.data]);

  const pick = (suggestion: StatusSuggestion) => {
    setEmoji(suggestion.emoji);
    setText(suggestion.text);
    setClearAfter(suggestion.clearAfter);
    setPause(suggestion.pauses);
    if (suggestion.clearAfter === "custom") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 7);
      tomorrow.setHours(23, 59, 0, 0);
      setUntil(toLocalInput(tomorrow));
    }
  };

  const hasStatus = Boolean(emoji || text.trim());

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (settings.data && showActivity !== settings.data.showActivity) {
        const result = await setShowActivity({ show: showActivity });
        if (!result.success) throw new Error(result.error);
        // The publisher leaves its presence room now, not at the next heartbeat.
        window.dispatchEvent(new CustomEvent(PRESENCE_VISIBILITY_EVENT, { detail: { hidden: !showActivity } }));
      }
      if (hasStatus) {
        const end = clearAfterToDate(clearAfter, new Date(), until ? new Date(until) : null);
        if (clearAfter === "custom" && !end) {
          toast.error("Choose when the status should clear");
          return;
        }
        const result = await setMyStatus({
          emoji,
          text: text.trim() || null,
          expiresAt: end ? end.toISOString() : null,
          pauseNotifications: pause,
          visibility,
        });
        if (!result.success) throw new Error(result.error);
      } else if (settings.data && visibility !== settings.data.visibility) {
        const result = await setStatusVisibility({ visibility });
        if (!result.success) throw new Error(result.error);
      }
      await refresh();
      toast.success(hasStatus ? "Status updated" : "Saved");
      setOpen(false);
    } catch {
      toast.error("Couldn’t save your status", { description: "Check the end time and try again." });
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    const result = await clearMyStatus();
    setSaving(false);
    if (!result.success) return void toast.error("Couldn’t clear your status");
    await refresh();
    toast.success("Status cleared");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="wide" showCloseButton={false} className="flex max-h-[90vh] w-[480px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <DialogTitle className="text-[20px] font-bold">Set a status</DialogTitle>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <X size={18} />
          </button>
        </div>
        <div className="app-scroll app-scroll-y min-h-0 flex-1">
          <div className="flex flex-col gap-2 px-6 pb-4">
            <label htmlFor="nb-status-text" className="text-[13px] font-semibold">Your status</label>
            <div className="flex min-h-12 items-center gap-2 rounded-lg border-2 border-input px-1.5 focus-within:border-primary">
              <EmojiChoice value={emoji} onChange={setEmoji} />
              <input
                id="nb-status-text"
                value={text}
                maxLength={STATUS_TEXT_MAX}
                placeholder="What’s your status?"
                onChange={(event) => setText(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <CharCount value={text.length} max={STATUS_TEXT_MAX} />
            </div>
          </div>

          <div className="flex flex-col gap-0.5 px-3 pb-3">
            <span className="px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Suggestions</span>
            {STATUS_SUGGESTIONS.map((suggestion) => {
              const chosen = emoji === suggestion.emoji && text === suggestion.text;
              return (
                <button
                  key={suggestion.text}
                  type="button"
                  onClick={() => pick(suggestion)}
                  aria-pressed={chosen}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left ${chosen ? "bg-muted" : "hover:bg-muted"}`}
                >
                  <span aria-hidden="true" className="w-7 text-center font-[system-ui] text-[22px] leading-none">{suggestion.emoji}</span>
                  <span className="text-[15px] font-medium">{suggestion.text}</span>
                  <span className="ml-auto text-[13px] text-muted-foreground">{DURATION_HINT[suggestion.clearAfter]}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-3.5 border-t border-border px-6 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nb-status-clear" className="text-[13px] font-semibold">Clear after</label>
              <select
                id="nb-status-clear"
                value={clearAfter}
                onChange={(event) => setClearAfter(event.target.value as ClearAfter)}
                className="min-h-11 rounded-lg border border-input bg-card px-3 text-[15px]"
              >
                {CLEAR_AFTER.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {clearAfter === "custom" ? (
                <input
                  type="datetime-local"
                  aria-label="Clear the status at"
                  value={until}
                  min={toLocalInput(new Date())}
                  onChange={(event) => setUntil(event.target.value)}
                  className="min-h-11 rounded-lg border border-input bg-card px-3 text-[15px]"
                />
              ) : null}
            </div>
            <div className="flex min-h-11 items-center gap-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-medium">Pause notifications</span>
                <span className="text-[13px] text-muted-foreground">Until the status clears. Mentions wait in Activity.</span>
              </div>
              <Switch checked={pause} onChange={setPause} label="Pause notifications" />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-6 py-4">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Who sees it</span>
            <div className="flex min-h-11 items-center gap-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-medium">Show when I’m active</span>
                <span className="text-[13px] text-muted-foreground">Off: everyone sees you as Offline, and you see others&apos; activity only as Offline too.</span>
              </div>
              <Switch checked={showActivity} onChange={setShowActivityState} label="Show when I’m active" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nb-status-audience" className="text-[13px] font-semibold">Status visible to</label>
              <select
                id="nb-status-audience"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value as StatusVisibility)}
                className="min-h-11 rounded-lg border border-input bg-card px-3 text-[15px]"
              >
                <option value="everyone">Everyone on NetworkBase</option>
                <option value="network">Connections and workspace members</option>
                <option value="team">Workspace members</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-border px-6 py-4">
          {settings.data?.status ? (
            <button type="button" disabled={saving} onClick={() => void clear()} className="min-h-11 rounded-lg border border-border px-4 text-[14px] font-semibold hover:bg-muted disabled:opacity-50">
              Clear status
            </button>
          ) : null}
          <button type="button" disabled={saving} onClick={() => void save()} className="ml-auto min-h-11 rounded-lg bg-primary px-5 text-[14px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
