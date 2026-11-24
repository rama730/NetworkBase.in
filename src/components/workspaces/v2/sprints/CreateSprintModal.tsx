"use client";

import React from "react";
import { typeProfile } from "@/lib/organizations/type-profile";
import { buildSprintSeries, insideError, nextOrgSprintStart, nextSeriesNumber, seriesPreview } from "@/lib/organizations/sprint-rules";
import { ChevronDown, Trash2, X } from "@/components/ui/icons";
import { z } from "zod";

import type { SprintListItem } from "@/lib/workspaces/sprint-detail";
import {
  addDaysToSprintDateInput,
  buildSprintEditorDraft,
  createSprintDraftSchema,
  type SprintDeleteImpact,
  type SprintEditorSubmission,
  type SprintOrgFields,
  type SprintEditorDraft,
  type SprintEditorMode,
} from "@/lib/workspaces/sprints";
import { recordSprintMetric } from "@/lib/workspaces/sprint-observability";
import { termStrip } from "@/lib/workspaces/sprint-plan";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { SprintAddWorkPanel, type AddWorkTargets } from "@/components/workspaces/tabs/sprint/SprintAddWork";
import { cn } from "@/lib/utils";
import { Notice } from "@/components/ui/notice";
import { aWord, type SprintWords } from "@/lib/organizations/sprint-words";
import { dayText, relativeDay, todayInZone } from "@/lib/organizations/zoned-time";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, QuickChips, SectionDivider, selectClassName, SelectWrap } from "../tasks/form-parts";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type SprintEditorSubmitResult = {
  success: boolean;
  error?: string;
};

interface SprintEditorModalProps {
  projectId: string;
  isOpen: boolean;
  mode: SprintEditorMode;
  onClose: () => void;
  onSubmit: (data: SprintEditorSubmission) => Promise<SprintEditorSubmitResult>;
  onDelete?: () => Promise<SprintEditorSubmitResult>;
  sprint?: SprintListItem | null;
  sprintCount?: number;
  deleteImpact?: SprintDeleteImpact | null;
  /** Organizations and child projects (report §15.2, §15.5); plain projects get only "Start automatically". */
  org?: {
    kind: "org" | "child";
    orgTitle: string | null;
    orgSprints: Array<{ id: string; name: string; status: string; startDate: string; endDate: string }>;
    /** Orgs: name suggestions by type and the Work defaults for a new sprint (report §15.2, §21). */
    orgType?: string | null;
    defaults?: { autoStart: boolean; showInChildren: boolean; createMatching: boolean; notifyOnStart: boolean };
    /** Orgs: Repeat warns past it (report §28.2). Workspaces: every sprint sits inside one; group work to bring. */
    termEnd?: string | null;
    followsOrgSprints?: boolean;
    groupBacklog?: number;
    /** Orgs: the workspaces a sprint can be shared with (live-fix 34). */
    children?: Array<{ id: string; title: string }>;
    /** Sprint redesign (2026-11-09): Unit and Week, Phase and Sprint, or the organization's own word. */
    words?: SprintWords;
  } | null;
  initialOrgFields?: SprintOrgFields;
  /** This workspace's sprints: Repeat numbering and overlaps, and Move later sprints (report §28.2). */
  existingSprints?: Array<{ id: string; name: string; startDate: string | null; endDate: string | null; status: string; parentSprintId?: string | null }>;
  /** Board/review report §6: opens on the inner tab (Week, Sprint), inside this main sprint. */
  initialInsideOf?: string | null;
  /** Repeat ("Plan more like this", decision 9): creates the series instead of one sprint. */
  onRepeat?: (input: { prefix: string; count: number; lengthDays: number; startDate: string; goal: string; description: string; autoStart: boolean; parentSprintId?: string | null }) => Promise<SprintEditorSubmitResult>;
  /** Workspaces in an organization: Plan one for each planned organization sprint (report §18.2). Off by default. */
  onPlanEach?: (name: string) => Promise<SprintEditorSubmitResult>;
  /** 2026-11-09: Add work is New's last tab (Unit · Week · Add work); the sprints it can fill and their numbers. */
  addWork?: AddWorkTargets | null;
}

const DAY_MS = 86_400_000;
const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const rangeLabel = (start: string, end: string) => `${SHORT.format(utc(start))}–${SHORT.format(utc(end))}`;

type DraftField = keyof SprintEditorDraft;
type FieldErrors = Partial<Record<DraftField, string>>;
type PendingAction = "save" | "delete" | null;

function toFieldErrors(error: z.ZodError<z.infer<typeof createSprintDraftSchema>>) {
  const nextErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (typeof path === "string" && !(path in nextErrors)) {
      nextErrors[path as DraftField] = issue.message;
    }
  }
  return nextErrors;
}

export default function SprintEditorModal({
  projectId,
  isOpen,
  mode,
  onClose,
  onSubmit,
  onDelete,
  sprint = null,
  sprintCount = 0,
  deleteImpact = null,
  org = null,
  initialOrgFields,
  existingSprints = [],
  onRepeat,
  onPlanEach,
  initialInsideOf = null,
  addWork = null,
}: SprintEditorModalProps) {
  // Sprint redesign (2026-11-09): an organization plans Units with Weeks inside (a class), or Phases with Sprints inside.
  const words: SprintWords = org?.words ?? { main: typeProfile(org?.orgType).mainSprintWord, inner: typeProfile(org?.orgType).innerSprintWord, plan: "Plan", isClass: false };
  const mainWord = words.main;
  const innerWord = words.inner;
  // ponytail: plural by adding "s"; an organization's own word ending in s or y reads oddly, rename it if that shows.
  const mainPlural = `${mainWord.toLowerCase()}s`;
  const mains = existingSprints.filter((s) => !s.parentSprintId && s.startDate && s.endDate && (s.status === "planning" || s.status === "active") && s.id !== sprint?.id);
  // Sprint cleanup §1 (D1): once a main sprint exists, New sprint opens on the inner tab, in the one you're looking at
  // (or the running one, or the first planned one).
  const insidePick = () => (mode === "create" && org?.kind === "org"
    ? (initialInsideOf && mains.some((m) => m.id === initialInsideOf) ? initialInsideOf : null) ?? mains.find((m) => m.status === "active")?.id ?? mains[0]?.id ?? ""
    : initialInsideOf ?? "");
  const [level, setLevel] = React.useState<"main" | "inside" | "work">(() => (insidePick() ? "inside" : "main"));
  const [insideOf, setInsideOf] = React.useState<string>(insidePick);
  const nestedHere = org?.kind === "org" && (mode === "create" ? level === "inside" : Boolean(sprint?.parentSprintId));
  const insideParent = nestedHere ? existingSprints.find((s) => s.id === (mode === "create" ? insideOf : sprint?.parentSprintId)) ?? null : null;
  // Plan your sprint (report §18.2): inside the running organization sprint, or the next planned one, by default.
  const defaultParent = mode === "create" && org?.kind === "child"
    ? org.orgSprints.find((s) => s.id === initialOrgFields?.parentSprintId) ?? org.orgSprints.find((s) => s.status === "active") ?? org.orgSprints[0] ?? null
    : null;
  const [orgFields, setOrgFields] = React.useState<SprintOrgFields>(() => ({
    autoStart: initialOrgFields?.autoStart ?? org?.defaults?.autoStart ?? true,
    showInChildren: initialOrgFields?.showInChildren ?? org?.defaults?.showInChildren ?? true,
    sharedWith: initialOrgFields?.sharedWith ?? ((initialOrgFields?.showInChildren ?? org?.defaults?.showInChildren ?? true) ? "all" : "none"),
    sharedWorkspaceIds: initialOrgFields?.sharedWorkspaceIds ?? [],
    announce: false,
    createMatching: mode === "create" ? org?.defaults?.createMatching ?? false : false,
    parentSprintId: initialOrgFields?.parentSprintId ?? defaultParent?.id ?? null,
    notifyOnStart: initialOrgFields?.notifyOnStart ?? org?.defaults?.notifyOnStart ?? true,
    moveDueDates: false,
    moveLaterSprints: false,
    includeGroupWork: true,
  }));
  const [repeat, setRepeat] = React.useState(false);
  const [planEach, setPlanEach] = React.useState(false);
  const plannedOrgSprints = org?.kind === "child" ? org.orgSprints.filter((s) => s.status === "planning").length : 0;
  const [repeatCount, setRepeatCount] = React.useState(4);
  // Live-fix 32, 33: the next name in the series, starting the day after the last planned or running sprint ends.
  const orgDefaults = React.useCallback((base: Pick<SprintEditorDraft, "startDate" | "endDate">) => {
    if (org?.kind !== "org") return {};
    const prefix = `${words.main} `;
    const startDate = nextOrgSprintStart(existingSprints, base.startDate);
    const length = Math.round((Date.parse(`${base.endDate}T00:00:00Z`) - Date.parse(`${base.startDate}T00:00:00Z`)) / 86_400_000);
    return { name: `${prefix}${nextSeriesNumber(prefix, existingSprints.map((s) => s.name))}`, startDate, endDate: addDaysToSprintDateInput(startDate, Number.isFinite(length) ? length : 13) };
  }, [existingSprints, org, words.main]);
  const initialDraft = React.useCallback((): SprintEditorDraft => {
    const base = buildSprintEditorDraft({ sprint, sprintCount });
    if (mode !== "create") return base;
    // Report §7.6, smaller bug 14: an organization's next name follows its word ("Unit 4", "Phase 4").
    if (org?.kind === "org") return { ...base, ...orgDefaults(base) };
    // A team sprint's name is its own (report §18.2); its dates start inside the organization sprint.
    if (org?.kind === "child" && defaultParent) {
      const today = new Date().toISOString().slice(0, 10);
      const start = defaultParent.startDate.slice(0, 10) > today ? defaultParent.startDate.slice(0, 10) : today;
      return { ...base, name: "", startDate: start, endDate: defaultParent.endDate.slice(0, 10) };
    }
    return base;
  }, [defaultParent, mode, org, orgDefaults, sprint, sprintCount]);
  const [draft, setDraft] = React.useState<SprintEditorDraft>(initialDraft);
  // Post an announcement: prefilled from the form, editable (report §37.2).
  const defaultAnnouncement = mode === "edit"
    ? `${draft.name.trim() || "The sprint"} changed${draft.startDate && draft.endDate ? ` · now ${rangeLabel(draft.startDate, draft.endDate)}` : ""}.`
    : `${draft.name.trim() || "A new sprint"} is planned${draft.startDate ? ` · starts ${SHORT.format(utc(draft.startDate))}` : ""}.`;
  // Sprints can arrive after the form opens: move the untouched defaults along (Unit 1 → Unit 2, not Unit 1 again).
  const defaultsRef = React.useRef<{ name?: string; startDate?: string; endDate?: string }>({});
  React.useEffect(() => {
    if (mode !== "create" || org?.kind !== "org") return;
    setDraft((d) => {
      const before = defaultsRef.current;
      const next = orgDefaults(buildSprintEditorDraft({ sprint, sprintCount }));
      defaultsRef.current = next;
      const keep = (field: "name" | "startDate" | "endDate") => before[field] !== undefined && d[field] !== before[field];
      return { ...d, name: keep("name") ? d.name : next.name ?? d.name, startDate: keep("startDate") ? d.startDate : next.startDate ?? d.startDate, endDate: keep("endDate") ? d.endDate : next.endDate ?? d.endDate };
    });
  }, [mode, org, orgDefaults, sprint, sprintCount]);
  // Inside a main sprint, a new one starts the day after the last sprint in it (or on the main one's first day), two
  // weeks long, never past its end, and is named "Week N" (a class) or "Sprint N".
  React.useEffect(() => {
    if (mode !== "create" || org?.kind !== "org" || level !== "inside") return;
    const main = existingSprints.find((s) => s.id === insideOf);
    if (!main?.startDate || !main.endDate) return;
    const siblings = existingSprints.filter((s) => s.parentSprintId === main.id && s.endDate).map((s) => s.endDate!.slice(0, 10)).sort();
    const today = new Date().toISOString().slice(0, 10);
    const after = siblings.length ? addDaysToSprintDateInput(siblings.at(-1)!, 1) : main.startDate.slice(0, 10);
    const start = after > today ? after : main.startDate.slice(0, 10) > today ? main.startDate.slice(0, 10) : today;
    const lastDay = main.endDate.slice(0, 10);
    const end = addDaysToSprintDateInput(start, 13) > lastDay ? lastDay : addDaysToSprintDateInput(start, 13);
    const names = existingSprints.filter((s) => s.parentSprintId === main.id).map((s) => s.name);
    setDraft((d) => ({ ...d, name: `${innerWord} ${nextSeriesNumber(`${innerWord} `, names)}`, startDate: start, endDate: end }));
  }, [existingSprints, insideOf, level, mode, org?.kind, innerWord]);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = React.useState("");
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const firstFieldRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  // A failed save moves to the first field that needs something, as on New task.
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => { if (attempt) (bodyRef.current?.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(); }, [attempt]);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const pendingActionRef = React.useRef<PendingAction>(null);
  const onCloseRef = React.useRef(onClose);
  const editorKey = `${mode}:${sprint?.id ?? "new"}`;
  const initializedDraftKeyRef = React.useRef<string | null>(isOpen ? editorKey : null);

  React.useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!isOpen) {
      initializedDraftKeyRef.current = null;
      return;
    }
    if (initializedDraftKeyRef.current === editorKey) return;
    initializedDraftKeyRef.current = editorKey;
    setDraft(initialDraft());
    setRepeat(false);
    setPlanEach(false);
    const pick = insidePick();
    setLevel(pick ? "inside" : "main");
    setInsideOf(pick);
    setFieldErrors({});
    setErrorMessage("");
    setPendingAction(null);
    setConfirmDelete(false);
  }, [editorKey, initialDraft, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  const children = org?.children?.length ?? 0;
  // The strip compares a sprint with its own level: the sprints in the same main sprint, or the main sprints.
  const sameLevel = org?.kind === "org" ? existingSprints.filter((s) => (s.parentSprintId ?? null) === (insideParent?.id ?? null)) : existingSprints;
  const strip = draft.startDate && draft.endDate ? termStrip({ startDate: draft.startDate, endDate: draft.endDate }, sameLevel as never, sprint?.id ?? null) : null;
  const childParent = org?.kind === "child" ? org.orgSprints.find((s) => s.id === orgFields.parentSprintId) ?? null : null;
  const parent = childParent ?? (insideParent?.startDate && insideParent.endDate ? { id: insideParent.id, name: insideParent.name, status: insideParent.status, startDate: insideParent.startDate, endDate: insideParent.endDate } : null);
  // Report §18.2: errors appear beside the dates before saving.
  const dateError = parent && draft.startDate && draft.endDate
    ? insideError({ startDate: utc(draft.startDate), endDate: utc(draft.endDate) }, { name: parent.name, startDate: utc(parent.startDate), endDate: utc(parent.endDate) })
    : null;
  const lengthDays = draft.startDate && draft.endDate ? Math.round((utc(draft.endDate).getTime() - utc(draft.startDate).getTime()) / DAY_MS) + 1 : 0;
  const prefix = draft.name.replace(/\d+$/, "") || (nestedHere ? `${innerWord} ` : org?.kind === "org" ? `${mainWord} ` : "Sprint ");
  // Repeat's live preview (report §16.2, §28.2): organization sprints can't overlap; the term end only warns.
  const preview = React.useMemo(() => {
    if (!repeat || lengthDays < 1 || !draft.startDate) return null;
    try {
      const rows = buildSprintSeries({ prefix, count: repeatCount, lengthDays, startDate: draft.startDate, firstNumber: nextSeriesNumber(prefix, existingSprints.map((s) => s.name)) });
      const live = org?.kind === "org"
        ? sameLevel.filter((s) => s.startDate && s.endDate && ["planning", "active", "completed"].includes(s.status)).map((s) => ({ name: s.name, startDate: utc(s.startDate!), endDate: utc(s.endDate!) }))
        : [];
      // Inside a main sprint, its end is the limit (the server refuses past it); otherwise the term end only warns.
      return seriesPreview(rows, live, nestedHere && parent ? parent.endDate : org?.kind === "org" ? org.termEnd : null);
    } catch {
      return null;
    }
  }, [draft.startDate, existingSprints, lengthDays, org, prefix, repeat, repeatCount, insideOf, level]);
  // Move later sprints too (decision 59): only Planning sprints that start after this one.
  const shiftDays = sprint?.startDate && draft.startDate ? Math.round((utc(draft.startDate).getTime() - utc(sprint.startDate).getTime()) / DAY_MS) : 0;
  const laterSprints = mode === "edit" && sprint?.status === "planning" && sprint.startDate
    ? existingSprints.filter((s) => s.id !== sprint.id && s.status === "planning" && s.startDate && s.startDate > sprint.startDate!)
    : [];
  const isRunning = mode === "edit" && sprint?.status === "active";
  // Editing a main sprint: its planned sprints can move with it (board/review report §6).
  const insideCount = mode === "edit" && sprint ? existingSprints.filter((s) => s.parentSprintId === sprint.id && (s.status === "planning" || s.status === "active")).length : 0;
  // Sprint redesign: the words for what this form makes, and its one-line caption under the tabs.
  const kindWord = org?.kind === "org" ? (nestedHere ? innerWord : mainWord) : "sprint";
  const kindPlural = org?.kind === "org" ? (nestedHere ? `${innerWord.toLowerCase()}s` : mainPlural) : "sprints";
  // New's tabs: an organization's two kinds, then Add work; a workspace gets Sprint and Add work.
  const showTabs = mode === "create" && (org?.kind === "org" || Boolean(addWork));
  const caption = mode !== "create" ? null : level === "work" ? "Open work that isn’t in a sprint yet." : org?.kind !== "org" ? null : level === "main"
    ? (words.isClass ? `A longer part of the term. ${innerWord}s go inside it.` : `A longer stretch of work. ${innerWord}s go inside it.`)
    : `A short stretch inside ${aWord(mainWord)}.`;
  const innerBlocked = mode === "create" && org?.kind === "org" && level === "inside" && !mains.length;

  const handleFieldChange = React.useCallback((field: DraftField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      return {
        ...current,
        [field]: undefined,
      };
    });
  }, []);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage("");

      const parsed = createSprintDraftSchema.safeParse(draft);
      if (!parsed.success) {
        // Errors sit under their fields; the form moves to the first one.
        setFieldErrors(toFieldErrors(parsed.error));
        setAttempt((n) => n + 1);
        recordSprintMetric("project.sprint.editor.validation", {
          projectId,
          sprintId: sprint?.id ?? null,
          mode,
          field: parsed.error.issues[0]?.path[0] ?? "unknown",
          issueCount: parsed.error.issues.length,
        });
        return;
      }

      if (dateError || innerBlocked) {
        setAttempt((n) => n + 1);
        return;
      }
      setPendingAction("save");
      try {
        const result = planEach && onPlanEach
          ? await onPlanEach(parsed.data.name)
          : repeat && onRepeat
          ? await onRepeat({ prefix, count: repeatCount, lengthDays, startDate: parsed.data.startDate, goal: parsed.data.goal ?? "", description: parsed.data.description ?? "", autoStart: orgFields.autoStart ?? true, parentSprintId: nestedHere && mode === "create" ? insideParent?.id ?? null : null })
          : await onSubmit({
          ...parsed.data,
          autoStart: orgFields.autoStart,
          ...(org?.kind === "org" ? { sharedWith: orgFields.sharedWith, sharedWorkspaceIds: orgFields.sharedWith === "selected" ? orgFields.sharedWorkspaceIds ?? [] : [], createMatching: mode === "create" && orgFields.sharedWith !== "none" && orgFields.createMatching,
            notifyOnStart: orgFields.notifyOnStart, ...(orgFields.announce ? { announcement: (orgFields.announcement ?? defaultAnnouncement).trim() } : {}), ...(mode === "edit" ? { moveDueDates: orgFields.moveDueDates } : {}) } : {}),
          ...(org?.kind === "child" ? { parentSprintId: orgFields.parentSprintId ?? null, ...(mode === "create" ? { includeGroupWork: orgFields.includeGroupWork } : {}) } : {}),
          ...(org?.kind === "org" && mode === "create" ? { parentSprintId: nestedHere ? insideParent?.id ?? null : null } : {}),
          ...(mode === "edit" && insideCount && shiftDays ? { moveInsideSprints: orgFields.moveInsideSprints } : {}),
          ...(mode === "edit" && laterSprints.length && shiftDays ? { moveLaterSprints: orgFields.moveLaterSprints } : {}),
        });
        if (!result.success) {
          setErrorMessage(result.error ?? "Couldn’t save sprint");
          return;
        }
        onClose();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Couldn’t save sprint");
      } finally {
        setPendingAction(null);
      }
    },
    [dateError, innerBlocked, draft, laterSprints.length, lengthDays, mode, onClose, onPlanEach, onRepeat, onSubmit, planEach, org?.kind, orgFields, prefix, projectId, repeat, repeatCount, shiftDays, sprint?.id, nestedHere, insideParent?.id, insideCount],
  );
  React.useEffect(() => { if (errorMessage) bodyRef.current?.scrollTo({ top: 0 }); }, [errorMessage]);

  const handleDelete = React.useCallback(async () => {
    if (!onDelete || !deleteImpact?.canDelete) return;
    setErrorMessage("");
    setPendingAction("delete");
    try {
      const result = await onDelete();
      if (!result.success) {
        setErrorMessage(result.error ?? "Couldn’t delete sprint");
        return;
      }
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Couldn’t delete sprint");
    } finally {
      setPendingAction(null);
    }
  }, [deleteImpact?.canDelete, onClose, onDelete]);

  const setDuration = React.useCallback((days: number) => {
    if (!draft.startDate) return;
    // "1 week" is seven days, its last day counted.
    handleFieldChange("endDate", addDaysToSprintDateInput(draft.startDate, days - 1));
  }, [draft.startDate, handleFieldChange]);
  /** A starting day keeps the length already picked (two weeks by default). */
  const setStart = (day: string) => {
    handleFieldChange("startDate", day);
    const end = addDaysToSprintDateInput(day, (lengthDays || 14) - 1);
    handleFieldChange("endDate", parent && end > parent.endDate.slice(0, 10) ? parent.endDate.slice(0, 10) : end);
  };
  /** A shortcut that would pass the main sprint's end is off, with the reason (report §18.2). */
  const tooLong = (days: number) => Boolean(parent && draft.startDate && addDaysToSprintDateInput(draft.startDate, days - 1) > parent.endDate.slice(0, 10));

  if (!isOpen) return null;

  const isSubmitting = pendingAction === "save";
  const isDeleting = pendingAction === "delete";
  // Quick starts: today, next Monday, and right after the last sprint at this level (when that's later than today).
  const today = todayInZone(null);
  const monday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); })();
  const lastHere = sameLevel.filter((s) => s.id !== sprint?.id && (s.status === "planning" || s.status === "active") && s.endDate).sort((a, b) => a.endDate!.localeCompare(b.endDate!)).at(-1) ?? null;
  const afterLast = lastHere ? addDaysToSprintDateInput(lastHere.endDate!.slice(0, 10), 1) : null;
  const inRange = (day: string) => !parent || (day >= parent.startDate.slice(0, 10) && day <= parent.endDate.slice(0, 10));
  const startChips = [
    { label: "Today", day: today },
    { label: "Next Monday", day: monday },
    ...(afterLast && afterLast > today ? [{ label: `After ${lastHere!.name}`, day: afterLast }] : []),
  ].filter((c) => inRange(c.day));
  const restOfParent = parent && draft.startDate && draft.startDate <= parent.endDate.slice(0, 10)
    ? Math.round((utc(parent.endDate).getTime() - utc(draft.startDate).getTime()) / DAY_MS) + 1 : 0;
  const dateLine = draft.startDate && draft.endDate && lengthDays > 0
    ? `${dayText(draft.startDate)} – ${dayText(draft.endDate)} · ${lengthDays} ${lengthDays === 1 ? "day" : "days"}${lengthDays % 7 === 0 ? ` (${lengthDays / 7} ${lengthDays === 7 ? "week" : "weeks"})` : ""}${mode === "create" ? ` · starts ${relativeDay(Math.round((utc(draft.startDate).getTime() - utc(today).getTime()) / DAY_MS))}` : ""}`
    : null;
  const seriesLine = preview?.rows.length
    ? `${preview.rows.length} ${kindPlural}: ${preview.rows[0]!.name}–${preview.rows.at(-1)!.name} · ${rangeLabel(preview.rows[0]!.startDate, preview.rows.at(-1)!.endDate)}${nestedHere && insideParent ? `, inside ${insideParent.name}` : ""}.`
    : null;
  const check = (checked: boolean, onChange: (on: boolean) => void, label: React.ReactNode, help?: React.ReactNode) => (
    <label className="flex items-start gap-2 text-[13px] text-foreground">
      <input type="checkbox" className="nb-check mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{help ? <span className="block text-[12px] text-muted-foreground">{help}</span> : null}</span>
    </label>
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !pendingAction) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={FORM_DIALOG_CLASS}
        onCloseAutoFocus={(e) => {
          if (previousFocusRef.current) {
            e.preventDefault();
            previousFocusRef.current.focus();
          }
        }}
      >
        {/* Header, like New task's. */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="space-y-0.5">
            <DialogTitle className="text-base font-semibold text-foreground">
              {mode === "create" ? (showTabs ? "New" : "New sprint") : `Edit ${sprint?.name ?? "sprint"}`}
            </DialogTitle>
            <DialogDescription className={cn("text-xs text-muted-foreground", showTabs && "sr-only")}>
              {mode === "create"
                ? "A stretch of time with one goal. Work goes into it; when it ends, you close it."
                : "Change the name, goal or dates."}
            </DialogDescription>
          </div>
          <button
            type="button"
            aria-label="Close sprint editor"
            onClick={onClose}
            disabled={!!pendingAction}
            className="nb-touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Sprint redesign: New's tabs — Unit | Week | Add work (Phase | Sprint | Add work), or Sprint | Add work — with a caption. */}
        {showTabs ? (
          <div className="shrink-0 px-6">
            <UnderlineTabs label="What are you adding?" idPrefix="sprint-level" controls={false} value={level} onChange={(next) => { setLevel(next); if (next === "main") setDraft(initialDraft()); }}
              tabs={[{ key: "main" as const, label: org?.kind === "org" ? mainWord : "Sprint" }, ...(org?.kind === "org" ? [{ key: "inside" as const, label: innerWord }] : []), ...(addWork ? [{ key: "work" as const, label: "Add work" }] : [])]} />
            {caption ? <p className="pt-2 text-[13px] text-muted-foreground">{caption}</p> : null}
          </div>
        ) : null}

        {level === "work" && addWork ? <SprintAddWorkPanel projectId={projectId} targets={addWork} onDone={onClose} /> : (
        <form id="sprint-editor-form" onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {errorMessage ? <div role="alert" className="rounded-md border border-border bg-[var(--status-danger-soft)] px-3 py-2 text-xs font-mono text-destructive">{errorMessage}</div> : null}

            {innerBlocked ? (
              <Notice action={<button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setLevel("main")}>Plan {aWord(mainWord)}</button>}>
                Plan {aWord(mainWord)} first. {innerWord}s go inside one.
              </Notice>
            ) : null}

            {/* Where it sits: inside which main sprint (an organization's inner tab, or a team's sprint). */}
            {(mode === "create" && org?.kind === "org" && level === "inside" && mains.length) || (org?.kind === "child" && org.orgSprints.length > 0) || (mode === "edit" && insideParent) ? (
              <div className="space-y-3.5">
                <SectionDivider title="Where it sits" />
                {mode === "create" && org?.kind === "org" && level === "inside" && mains.length ? (
                  <Field label={`Inside which ${mainWord.toLowerCase()}`} htmlFor="sprint-inside-of">
                    <SelectWrap>
                      <select id="sprint-inside-of" value={insideOf} onChange={(e) => setInsideOf(e.target.value)} className={cn("nb-select nb-touch-target", selectClassName())}>
                        {mains.map((m) => <option key={m.id} value={m.id}>{m.name} · {rangeLabel(m.startDate!, m.endDate!)}{m.status === "active" ? " (running)" : ""}</option>)}
                      </select>
                    </SelectWrap>
                  </Field>
                ) : null}
                {mode === "edit" && insideParent ? <p className="text-[13px] text-muted-foreground">Inside {insideParent.name}. Its dates stay inside {insideParent.name}’s.</p> : null}
                {/* §6.5: a team's sprint starts from the organization sprint it sits inside. */}
                {org?.kind === "child" && org.orgSprints.length > 0 ? (
                  <Field label={`Inside ${org.orgTitle ?? "the organization"}’s ${mainWord.toLowerCase()}`} htmlFor="sprint-parent"
                    hint={parent ? `Your dates start as ${parent.name}’s (${rangeLabel(parent.startDate, parent.endDate)}); you can shorten them, not go outside.` : undefined}>
                    <SelectWrap>
                      <select
                        id="sprint-parent"
                        value={orgFields.parentSprintId ?? ""}
                        onChange={(e) => {
                          const picked = org.orgSprints.find((s) => s.id === e.target.value) ?? null;
                          setOrgFields((f) => ({ ...f, parentSprintId: picked?.id ?? null }));
                          // Picking one starts from its dates; the lead may shorten them but not go outside.
                          if (picked && mode === "create") {
                            handleFieldChange("startDate", picked.startDate.slice(0, 10));
                            handleFieldChange("endDate", picked.endDate.slice(0, 10));
                          }
                        }}
                        className={cn("nb-select nb-touch-target", selectClassName())}
                      >
                        {/* A workspace that follows its organization's sprints always sits inside one. */}
                        {!org.followsOrgSprints ? <option value="">Not inside one</option> : null}
                        {org.orgSprints.map((s) => <option key={s.id} value={s.id}>{s.name} · {rangeLabel(s.startDate, s.endDate)} ({s.status === "active" ? "running" : "planned"})</option>)}
                      </select>
                    </SelectWrap>
                  </Field>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-3.5">
              <SectionDivider title="Basics" />
              <Field label={repeat ? `First ${kindWord.toLowerCase()}` : "Name"} htmlFor="sprint-name" required error={fieldErrors.name}>
                <input
                  ref={firstFieldRef}
                  id="sprint-name"
                  value={draft.name}
                  onChange={(event) => handleFieldChange("name", event.target.value)}
                  placeholder={org?.kind === "org" ? `e.g., ${nestedHere ? innerWord : mainWord} 1` : org?.kind === "child" ? "e.g., Parser week" : "e.g., Sprint 4"}
                  className={cn("nb-touch-target", inputClassName(!!fieldErrors.name))}
                />
              </Field>
              <Field label={repeat ? `Goal for the first ${kindWord.toLowerCase()}` : "Goal"} htmlFor="sprint-goal" error={fieldErrors.goal}>
                <input
                  id="sprint-goal"
                  value={draft.goal}
                  onChange={(event) => handleFieldChange("goal", event.target.value)}
                  placeholder="One sentence everyone will read"
                  className={cn("nb-touch-target", inputClassName(!!fieldErrors.goal))}
                />
              </Field>
              <Field label="Notes" htmlFor="sprint-description" error={fieldErrors.description}>
                <textarea
                  id="sprint-description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) => handleFieldChange("description", event.target.value)}
                  placeholder="Scope, links, or how the team will work"
                  className={cn("nb-textarea", inputClassName(!!fieldErrors.description), "min-h-[60px] resize-y py-2")}
                />
              </Field>
            </div>

            <div className="space-y-3.5">
              {/* Sprint cleanup §2 (D3): one or several is a choice about dates, so it sits with them. */}
              <SectionDivider title="Dates">
                {mode === "create" && onRepeat && org?.kind !== "child" ? (
                  <div role="radiogroup" aria-label="How many sprints" className="inline-flex rounded-md border border-border p-0.5">
                    {([["one", "One"], ["several", "Several"]] as const).map(([key, label]) => (
                      <button key={key} type="button" role="radio" aria-checked={(key === "several") === repeat} onClick={() => setRepeat(key === "several")}
                        className={cn("nb-touch-target h-[24px] rounded-sm px-2.5 text-[12px]", (key === "several") === repeat ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </SectionDivider>
              <div className="grid grid-cols-2 gap-3">
                <Field label={repeat ? "First starts" : "Starts"} htmlFor="sprint-start-date" required error={fieldErrors.startDate}>
                  <input
                    id="sprint-start-date"
                    type="date"
                    disabled={isRunning}
                    title={isRunning ? "A running sprint keeps its start date." : undefined}
                    min={parent?.startDate.slice(0, 10)}
                    max={parent?.endDate.slice(0, 10)}
                    value={draft.startDate}
                    onChange={(event) => handleFieldChange("startDate", event.target.value)}
                    className={cn("nb-touch-target font-mono", inputClassName(!!fieldErrors.startDate))}
                  />
                </Field>
                <Field label={repeat ? `Each ${kindWord.toLowerCase()} ends` : "Ends"} htmlFor="sprint-end-date" required error={fieldErrors.endDate ?? dateError ?? undefined}>
                  <input
                    id="sprint-end-date"
                    type="date"
                    min={draft.startDate}
                    max={parent?.endDate.slice(0, 10)}
                    value={draft.endDate}
                    onChange={(event) => handleFieldChange("endDate", event.target.value)}
                    className={cn("nb-touch-target font-mono", inputClassName(!!fieldErrors.endDate || Boolean(dateError)))}
                  />
                </Field>
              </div>
              {!isRunning && startChips.length ? (
                <QuickChips label="Starts" items={startChips.map((c) => ({ label: c.label, active: draft.startDate === c.day, onClick: () => setStart(c.day) }))} />
              ) : null}
              <QuickChips label={repeat ? "Each lasts" : "Lasts"} items={[
                ...([[7, "1 week"], [14, "2 weeks"], [28, "4 weeks"]] as const).map(([days, label]) => ({ label, active: lengthDays === days, disabled: tooLong(days), onClick: () => setDuration(days) })),
                ...(nestedHere && parent && restOfParent > 0 && !repeat ? [{ label: `Rest of ${parent.name}`, active: draft.endDate === parent.endDate.slice(0, 10), onClick: () => handleFieldChange("endDate", parent.endDate.slice(0, 10)) }] : []),
              ]} />
              {dateLine ? <p className="text-xs text-muted-foreground" aria-live="polite">{dateLine}</p> : null}

              {/* §6.2: where the new sprint lands among the others. */}
              {strip && draft.startDate && draft.endDate ? (
                <div className="space-y-1" data-testid="term-strip">
                  <div className="flex gap-0.5 text-[11px]" aria-hidden="true">
                    {strip.before ? <span className="flex-1 truncate rounded-sm bg-muted px-1.5 py-1 text-muted-foreground">{strip.before}</span> : null}
                    <span className={cn("flex-[1.4] truncate rounded-sm border px-1.5 py-1", strip.clash ? "border-destructive bg-[var(--status-danger-soft)] text-destructive" : "border-primary bg-card text-foreground")}>
                      {draft.name.trim() || `This ${kindWord.toLowerCase()}`} · {rangeLabel(draft.startDate, draft.endDate)}
                    </span>
                    {strip.after ? <span className="flex-1 truncate rounded-sm bg-muted px-1.5 py-1 text-muted-foreground">{strip.after}</span> : null}
                  </div>
                  <p className={cn("text-[12px]", strip.clash ? "text-destructive" : "text-muted-foreground")}>{strip.line}</p>
                </div>
              ) : null}

              {repeat && mode === "create" && onRepeat && org?.kind !== "child" ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <label className="flex items-center gap-2 text-[13px] font-medium text-foreground">How many
                    <input type="number" min={2} max={52} value={repeatCount} onChange={(e) => setRepeatCount(Math.max(2, Math.min(52, Number(e.target.value) || 2)))}
                      className={cn(inputClassName(false), "w-20 font-mono")} />
                  </label>
                  {seriesLine ? <p className="text-[12px] text-muted-foreground">{seriesLine}</p> : <p className="text-xs text-muted-foreground">Set valid dates to see them.</p>}
                  {preview ? (<>
                    <ul aria-label="Sprints to create" className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[12px]">
                      {preview.rows.map((row) => (
                        <li key={row.name} className={cn(row.clash ? "text-destructive" : "text-foreground")}>
                          {row.name} · {rangeLabel(row.startDate, row.endDate)}
                          {row.clash ? ` · Overlaps ${row.clash}` : ""}
                          {row.pastTermEnd ? <span className="text-[var(--status-warning)]"> · {nestedHere && insideParent ? `Passes the end of ${insideParent.name}` : "Passes the term end"}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12px] text-muted-foreground">Goals for the rest can be written later, one at a time.</p>
                  </>) : null}
                  {preview?.blocked && preview.startAfter ? (
                    <button type="button" className="text-xs font-medium text-primary hover:underline"
                      onClick={() => { const start = preview.startAfter!; handleFieldChange("startDate", start); handleFieldChange("endDate", addDaysToSprintDateInput(start, lengthDays - 1)); }}>
                      Start after {preview.rows.find((r) => r.clash)?.clash}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {insideCount && shiftDays ? check(orgFields.moveInsideSprints ?? false, (on) => setOrgFields((f) => ({ ...f, moveInsideSprints: on })), `Move the ${innerWord.toLowerCase()}s inside too`,
                `Its ${insideCount} planned ${insideCount === 1 ? innerWord.toLowerCase() : `${innerWord.toLowerCase()}s`} ${insideCount === 1 ? "moves" : "move"} by ${Math.abs(shiftDays)} ${Math.abs(shiftDays) === 1 ? "day" : "days"}, so they stay inside.`) : null}
              {laterSprints.length && shiftDays ? check(orgFields.moveLaterSprints ?? false, (on) => setOrgFields((f) => ({ ...f, moveLaterSprints: on })), "Move later sprints too",
                `${laterSprints.map((s) => s.name).join(", ")} also ${laterSprints.length === 1 ? "moves" : "move"} by ${Math.abs(shiftDays)} ${Math.abs(shiftDays) === 1 ? "day" : "days"}.`) : null}
            </div>

            {/* Who sees it: an organization's sprint and its workspaces (live-fix 34, report §37.2). */}
            {org?.kind === "org" ? (
              <div className="space-y-3.5">
                <SectionDivider title="Who sees it" />
                <fieldset className="space-y-1.5">
                  <legend className="text-[13px] font-medium text-foreground">Share with workspaces</legend>
                  <div className="flex flex-wrap gap-4 text-[13px]">
                    {([["all", children ? `All ${children}` : "All"], ["selected", "Selected"], ["none", "None"]] as const).map(([value, label]) => (
                      <label key={value} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="sprint-share" value={value} checked={orgFields.sharedWith === value} onChange={() => setOrgFields((f) => ({ ...f, sharedWith: value }))} />{label}</label>
                    ))}
                  </div>
                  {orgFields.sharedWith === "selected" ? (
                    (org.children ?? []).length ? (
                      <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border" aria-label="Workspaces to share with">
                        {(org.children ?? []).map((c) => (
                          <li key={c.id}><label className="flex items-center gap-2 px-3 py-1.5 text-[13px]"><input type="checkbox" className="nb-check" checked={orgFields.sharedWorkspaceIds?.includes(c.id) ?? false}
                            onChange={(e) => setOrgFields((f) => ({ ...f, sharedWorkspaceIds: e.target.checked ? [...(f.sharedWorkspaceIds ?? []), c.id] : (f.sharedWorkspaceIds ?? []).filter((id) => id !== c.id) }))} />{c.title}</label></li>
                        ))}
                      </ul>
                    ) : <p className="text-[12px] text-muted-foreground">No workspaces in the organization yet.</p>
                  ) : null}
                </fieldset>
                {mode === "create" && orgFields.sharedWith !== "none"
                  ? check(orgFields.createMatching ?? false, (on) => setOrgFields((f) => ({ ...f, createMatching: on })), "Teams plan their own sprint inside it", "Each workspace gets a sprint with the same dates.")
                  : null}
              </div>
            ) : null}

            {org?.kind === "child" && mode === "create" && ((onPlanEach && plannedOrgSprints > 1) || (parent && (org.groupBacklog ?? 0) > 0)) ? (
              <div className="space-y-3.5">
                <SectionDivider title="Also" />
                {onPlanEach && plannedOrgSprints > 1 ? check(planEach, setPlanEach, `Plan one for each of ${org.orgTitle ?? "the organization"}’s ${plannedOrgSprints} planned ${mainPlural}`) : null}
                {parent && (org.groupBacklog ?? 0) > 0
                  ? check(orgFields.includeGroupWork ?? true, (on) => setOrgFields((f) => ({ ...f, includeGroupWork: on })), `Also add ${org.groupBacklog} group ${org.groupBacklog === 1 ? "assignment" : "assignments"} from the backlog`)
                  : null}
              </div>
            ) : null}

            {/* The settings that rarely change wait behind More options, as on New assignment. */}
            <details className="group rounded-md border border-border" open={mode === "edit" && org?.kind === "org" && shiftDays !== 0 ? true : undefined}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
                <span>More options <span className="font-normal text-muted-foreground">· {orgFields.autoStart ?? true ? (repeat ? "each starts by itself" : "starts by itself") : "waits for Start now"}{org?.kind === "org" && orgFields.announce ? " · posts an announcement" : ""}</span></span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="space-y-3 border-t border-border px-3 py-3">
                {check(orgFields.autoStart ?? true, (on) => setOrgFields((f) => ({ ...f, autoStart: on })), "Start automatically on the start date")}
                {org?.kind === "org" ? (<>
                  {check(orgFields.notifyOnStart ?? true, (on) => setOrgFields((f) => ({ ...f, notifyOnStart: on })), "Tell members when it starts")}
                  {/* Post an announcement, when creating or changing a sprint (report §37.2). */}
                  {check(orgFields.announce ?? false, (on) => setOrgFields((f) => ({ ...f, announce: on })), "Post an announcement")}
                  {orgFields.announce ? <textarea aria-label="Announcement" rows={2} maxLength={5000} value={orgFields.announcement ?? defaultAnnouncement}
                    onChange={(e) => setOrgFields((f) => ({ ...f, announcement: e.target.value }))} className={cn("nb-textarea", inputClassName(false), "min-h-[60px] resize-y py-2")} /> : null}
                  {mode === "edit" ? check(orgFields.moveDueDates ?? false, (on) => setOrgFields((f) => ({ ...f, moveDueDates: on })), "Move due dates too", "If the dates change, its assignments move by the same number of days.") : null}
                </>) : null}
              </div>
            </details>

            {/* Delete: Planning only; once started, Cancel instead (report §37.2). */}
            {mode === "edit" && sprint?.status === "planning" ? (
              <div className="space-y-3.5">
                <SectionDivider title="Delete" />
                {!deleteImpact?.canDelete ? (
                  <Notice tone="warning">{deleteImpact?.reason ?? "This sprint can’t be deleted right now."}</Notice>
                ) : confirmDelete ? (
                  <Notice tone="danger" action={<>
                    <button type="button" disabled={!!pendingAction} onClick={() => setConfirmDelete(false)} className={FORM_SECONDARY_CLASS}>Keep it</button>
                    <button type="button" disabled={!!pendingAction} onClick={() => void handleDelete()} className={cn(FORM_PRIMARY_CLASS, "inline-flex items-center gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive")}>
                      <Trash2 className="size-3.5" aria-hidden="true" />{isDeleting ? "Deleting…" : `Delete ${deleteImpact.sprintName}`}
                    </button>
                  </>}>
                    Delete {deleteImpact.sprintName}? This can’t be undone.
                  </Notice>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
                    <p className="text-muted-foreground">{deleteImpact.affectedTaskCount ? `${deleteImpact.affectedTaskCount} ${deleteImpact.affectedTaskCount === 1 ? "task is" : "tasks are"} in it.` : "Nothing is in it yet."} Delete works only on an empty, planned sprint.</p>
                    <button type="button" disabled={!!pendingAction} onClick={() => setConfirmDelete(true)} className={cn(FORM_SECONDARY_CLASS, "inline-flex items-center gap-1.5 text-destructive")}>
                      <Trash2 className="size-3.5" aria-hidden="true" />Delete…
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Fixed footer, like New task's: the button names what it makes. */}
          <div className={FORM_FOOTER_CLASS}>
            <button type="button" disabled={!!pendingAction} onClick={onClose} className={FORM_SECONDARY_CLASS}>Cancel</button>
            <button type="submit" disabled={!!pendingAction || Boolean(repeat && preview?.blocked)} className={FORM_PRIMARY_CLASS}>
              {isSubmitting ? "Saving…" : mode === "create" ? (planEach && onPlanEach ? `Create ${plannedOrgSprints} sprints` : repeat && preview ? `Create ${preview.rows.length} ${kindPlural}` : `Create ${draft.name.trim() || kindWord.toLowerCase()}`) : "Save changes"}
            </button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
