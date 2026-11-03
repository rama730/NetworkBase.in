"use client";

/**
 * ContributionWorkspace
 *
 * Full-screen drafting table workspace for composing, editing, reordering, and publishing
 * verified project contribution stories and multi-stage career progression timelines.
 *
 * Key Architectural Highlights:
 * - Deterministic navigation & breadcrumb return path ("Back to project contributions").
 * - Multi-stage progression editor preserving verified platform roles and external titles.
 * - Single active current role reconciliation and date validation across stages.
 * - In-page anchor tabs (identity, summary, positions, work, skills) for quick scrolling.
 * - IndexedDB draft auto-saving with offline recovery and safe discarding.
 * - Strict adherence to Ponytail design tokens and contract assertions.
 */

import { editorEntryStatus, groupProfileContributions } from "@/lib/organizations/profile-rules";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { get, set, del, createStore } from "idb-keyval";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Pencil,
  Check,
  X,
  Info,
  ShieldCheck,
  Eye,
  EyeOff,
  Pin,
  Upload,
  Trash2,
  ImagePlus,
  Download,
  Link2,
  RotateCcw,
  Globe,
  FileText,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { compressImage } from "@/lib/messaging/image-compression";
import { scrollContributionEditorTarget } from "@/lib/profile/contribution-editor-scroll";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/SearchField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SkillPicker } from "@/components/skills/SkillPicker";
import {
  ContributionStoryView,
  ContributionIdentityLinks,
} from "@/components/profile/ContributionStoryView";
import { ContributionSummaryEditor } from "./ContributionSummaryEditor";
import { OrgStoryHelpers } from "./OrgStoryHelpers";
import {
  createContributionStoryAction,
  saveContributionStoryAction,
  searchContributionReferencesAction,
  createContributionImageUploadAction,
  finalizeContributionImageAction,
  importContributionWorkspaceImageAction,
  listContributionLinkWorkspacesAction,
  type StoryCommand,
} from "@/app/actions/contribution-stories";
import { loadProfileContributionWindow } from "@/lib/profile/browser-profile";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import type { ContributionEditorEntry } from "@/lib/profile/contribution-editor";
import { saveBlob } from "@/lib/download";
import {
  storyFromContribution,
  mergeContributionStory,
  storyPeriod,
  storyMonth,
  storyValidation,
  sortedStoryPositions,
  positionDuration,
  removeStoryPosition,
  parseContributionStory,
  reconcileStoryCurrentStatus,
  type ContributionStory,
  type StoryPosition,
  type StoryReferenceKind,
  type ResolvedStoryReference,
  STORY_REFERENCE_PATTERN,
} from "@/lib/profile/contribution-story";

type Item = ProfileCollaborationContribution;
type Undo = { label: string; run: () => void };
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
let recoveryStore: ReturnType<typeof createStore> | null = null;
const draftStorage = () =>
  (recoveryStore ??= createStore("networkbase-contribution-drafts", "drafts"));
function Field({
  label,
  children,
  help,
  error,
  helpId,
  errorId,
}: {
  label: string;
  children: React.ReactNode;
  help?: string;
  error?: string;
  helpId?: string;
  errorId?: string;
}) {
  return (
    <label className="nb-story-field">
      <span>{label}</span>
      {children}
      {help && <small id={helpId}>{help}</small>}
      {error && (
        <span id={errorId} role="alert" className="nb-compact text-destructive">
          {error}
        </span>
      )}
    </label>
  );
}
const roleCount = (n: number) => `${n} ${n === 1 ? "position" : "positions"}`;

/** A list preview: mentions become their names, Markdown marks and backslash escapes go (live-fix 60). */
function previewText(summary: string, refs: Array<{ kind: string; id: string; label: string }>) {
  return summary
    .replace(new RegExp(STORY_REFERENCE_PATTERN), (_m, kind: string, id: string) => refs.find((ref) => ref.kind === kind && ref.id === id)?.label ?? "")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    .replace(/[*#_`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Why a contribution doesn't show to visitors, first reason first (live-fix 65). */
function hiddenReason(c: { visibility?: string | null; presentation?: { visible?: boolean } | null; projectVisibility?: string | null; projectStatus?: string | null }, profileVisibility: string | null | undefined) {
  if (!c.presentation) return "It isn’t published yet. Publish it to show it.";
  if (c.visibility === "private" || c.presentation.visible === false) return "Show on profile is off for it.";
  if (c.projectVisibility === "private") return "Its workspace is private.";
  if (["draft", "deleted"].includes(c.projectStatus ?? "")) return "Its workspace isn’t live.";
  if (profileVisibility !== "public") return "Your profile isn’t public.";
  return null;
}

export function ContributionEditor({
  items,
  profileId,
  profileVisibility = "public",
  hasMore,
  onLoadMore,
  loadingMore,
  footerContainer,
  onCancel,
}: {
  items: ContributionEditorEntry[];
  profileId: string;
  profileVisibility?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  footerContainer?: HTMLElement | null;
  onCancel?: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [validationProject, setValidationProject] = useState<string | null>(
    null,
  );
  const [records, setRecords] = useState<Item[]>(() =>
    items.flatMap((e) => (e.contribution ? [e.contribution] : [])),
  );
  const [selected, setSelected] = useState<string | null>(
    params.get("contribution"),
  );
  const [documents, setDocuments] = useState<Record<string, ContributionStory>>(
    {},
  );
  const bases = useRef<Record<string, ContributionStory>>({ ...documents }),
    versions = useRef<Record<string, number>>(
      Object.fromEntries(records.map((r) => [r.id, r.version ?? 1])),
    ),
    docs = useRef(documents);
  docs.current = documents;
  const [pauseAutosave, setPauseAutosave] = useState(false);
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false),
    [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState("Private draft saved"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const [roleEdit, setRoleEdit] = useState<string | null>(null),
    [preview, setPreview] = useState<"draft" | "visitor" | null>(null),
    [undo, setUndo] = useState<Undo | null>(null),
    [conflict, setConflict] = useState<Item | null>(null);
  const [confirm, setConfirm] = useState<"unlisted" | "delete" | null>(null),
    [consent, setConsent] = useState(false),
    [linkOpen, setLinkOpen] = useState(false),
    [linkTarget, setLinkTarget] = useState(""),
    [duplicateId, setDuplicateId] = useState<string | null>(null),
    [mergeConsent, setMergeConsent] = useState(false);
  const [picker, setPicker] = useState<{
      kind: StoryReferenceKind;
      insert?: (r: ResolvedStoryReference) => void;
      images?: boolean;
      onCancel?: () => void;
    } | null>(null),
    [query, setQuery] = useState(""),
    [options, setOptions] = useState<ResolvedStoryReference[]>([]),
    [optionsLoading, setOptionsLoading] = useState(false);
  const [linkOptions, setLinkOptions] = useState<
      Array<{ id: string; title: string }>
    >([]),
    [linkQuery, setLinkQuery] = useState("");
  const [references, setReferences] = useState<ResolvedStoryReference[]>([]),
    [pending, setPending] = useState<
      Array<{
        id: string;
        owner: string;
        replaceId: string | null;
        file: File;
        error?: string;
      }>
    >([]);
  const cancelledUploads = useRef(new Set<string>());
  const uploadInput = useRef<HTMLInputElement>(null),
    uploadTrigger = useRef<HTMLButtonElement | null>(null),
    replacement = useRef<string | null>(null),
    request = useRef<{ key: string; id: string } | null>(null),
    channel = useRef<BroadcastChannel | null>(null),
    saveRef = useRef<
      (op?: StoryCommand["operation"], id?: string) => Promise<void>
    >(async () => {});
  const active = records.find((r) => r.id === selected),
    d = selected ? documents[selected] : undefined;
  // Decision 104 (report §38.3): the server keeps these from the record, so the editor shows them locked.
  const recordLocked =
    !!active && active.source !== "manual" && (active.projectKind === "organization" || !!active.parentOrg);
  // Live-fix 61, 62: an organization entry reads as the organization's, not a workspace's.
  const isOrgEntry = active?.projectKind === "organization";
  const setByTitle = isOrgEntry ? active?.projectTitle : active?.parentOrg?.title;
  const orgSlugOrId = active?.parentOrg ? (active.parentOrg.slug ?? active.parentOrg.id) : active?.projectKind === "organization" ? active.projectId : null;
  const adminsHref = orgSlugOrId ? `/org/${encodeURIComponent(orgSlugOrId)}?tab=members` : null;
  const validationIssues =
    active && d && validationProject === active.id
      ? storyValidation(d, { publish: true, platform: !!active.projectId })
      : [];
  const hasPublishChanges =
    !!active &&
    !!d &&
    (!same(
      d,
      active.presentation ??
        storyFromContribution({ ...active, draftStory: null }),
    ) ||
      pending.some((image) => image.owner === active.id));
  const key = (id: string) => `${profileId}:${id}`;
  const patch = useCallback(
    (
      id: string,
      changes:
        | Partial<ContributionStory>
        | ((doc: ContributionStory) => ContributionStory),
    ) => {
      setDocuments((current) => {
        const old = current[id];
        if (!old) return current;
        return {
          ...current,
          [id]: reconcileStoryCurrentStatus(
            typeof changes === "function"
              ? changes(old)
              : { ...old, ...changes },
          ),
        };
      });
      setError(null);
      setStatus("Saving private draft…");
    },
    [],
  );
  const nav = (id: string | null) => {
    setSelected(id);
    setRoleEdit(null);
    setError(null);
    setValidationProject(null);
    setPauseAutosave(false);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("contribution", id);
    else url.searchParams.delete("contribution");
    window.history.replaceState(window.history.state, "", url);
  };
  const refresh = useCallback(async () => {
    const page = await loadProfileContributionWindow(
      profileId,
      Math.max(Object.keys(docs.current).length, 50),
    );
    setRecords(page.contributions);
    return page.contributions;
  }, [profileId]);
  useEffect(() => {
    const additions = items.flatMap((e) =>
      e.contribution ? [e.contribution] : [],
    );
    setRecords((current) => {
      const ids = new Set(current.map((r) => r.id));
      return [...current, ...additions.filter((r) => !ids.has(r.id))];
    });
  }, [items]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const r of records) {
        if (docs.current[r.id]) continue;
        const server = storyFromContribution(r);
        let recovered: ContributionStory | null = null;
        try {
          const stored = await get<{
            document: unknown;
            base: unknown;
            version: number;
          }>(key(r.id), draftStorage());
          if (
            stored &&
            stored.version === (r.version ?? 1) &&
            same(stored.base, server)
          )
            recovered = parseContributionStory(stored.document);
          else if (stored) {
            recovered = parseContributionStory(stored.document);
            setPauseAutosave(true);
            setConflict(r);
            setError(
              "A recovered draft has a different saved version. Review it before replacing the latest draft.",
            );
          }
        } catch {
          setStatus(
            "Local recovery unavailable. Save your draft before leaving.",
          );
        }
        if (cancelled) return;
        bases.current[r.id] = server;
        versions.current[r.id] = r.version ?? 1;
        setDocuments((current) =>
          current[r.id] ? current : { ...current, [r.id]: recovered ?? server },
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [records, profileId]);
  useEffect(() => {
    for (const row of records) {
      if (
        !docs.current[row.id] ||
        versions.current[row.id] === (row.version ?? 1)
      )
        continue;
      if (same(docs.current[row.id], bases.current[row.id])) {
        const latest = storyFromContribution(row);
        bases.current[row.id] = latest;
        versions.current[row.id] = row.version ?? 1;
        setDocuments((current) => ({ ...current, [row.id]: latest }));
      } else if (selected === row.id) {
        setPauseAutosave(true);
        setConflict(row);
      }
    }
  }, [records, selected]);
  useEffect(() => {
    const dirty = Object.entries(documents).filter(
      ([id, doc]) => !same(doc, bases.current[id]),
    );
    if (!dirty.length || pauseAutosave) return;
    let alive = true;
    for (const [id, document] of dirty)
      void set(
        key(id),
        { document, base: bases.current[id], version: versions.current[id] },
        draftStorage(),
      ).catch(() => {
        if (alive)
          setStatus(
            "Local recovery failed. Keep this page open and retry Save draft.",
          );
      });
    const timer = setTimeout(() => {
      if (!busyRef.current) void saveRef.current("draft", dirty[0]![0]);
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [documents, busy, profileId, pauseAutosave]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (
        Object.entries(docs.current).some(
          ([id, doc]) => !same(doc, bases.current[id]),
        )
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    const bc = new BroadcastChannel(`contribution-stories:${profileId}`);
    channel.current = bc;
    bc.onmessage = () => {
      void refresh().catch(() =>
        setError("Couldn’t check for changes from another session."),
      );
    };
    const focus = () => {
      void refresh().catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => {
      bc.close();
      channel.current = null;
      window.removeEventListener("focus", focus);
    };
  }, [profileId, refresh]);
  useEffect(() => {
    if (!active) return;
    setReferences((current) =>
      Array.from(
        new Map(
          [
            ...current,
            ...(active.resolvedReferences ?? []),
            ...(active.draftReferences ?? []),
          ].map((ref) => [`${ref.kind}:${ref.id}`, ref]),
        ).values(),
      ),
    );
  }, [active?.id, active?.draftReferences, active?.resolvedReferences]);
  useEffect(() => {
    if (roleEdit)
      document
        .getElementById(`story-role-title-${roleEdit}`)
        ?.focus({ preventScroll: true });
  }, [roleEdit]);
  useEffect(() => {
    if (!picker || !active) return;
    let cancelled = false;
    setOptions([]);
    setOptionsLoading(true);
    const timer = setTimeout(() => {
      void searchContributionReferencesAction(active.id, picker.kind, query)
        .then((result) => {
          if (!cancelled) setOptions(result);
        })
        .catch(() => {
          if (!cancelled) setError("Couldn’t load references. Try again.");
        })
        .finally(() => {
          if (!cancelled) setOptionsLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [picker?.kind, picker?.images, active?.id, query]);
  useEffect(() => {
    if (!linkOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void listContributionLinkWorkspacesAction(linkQuery)
        .then((options) => {
          if (!cancelled) setLinkOptions(options);
        })
        .catch(() => setError("Couldn’t load your workspaces. Try again."));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [linkOpen, linkQuery]);
  async function save(
    operation: StoryCommand["operation"] = "draft",
    contributionId?: string,
  ) {
    const active = records.find(
      (record) => record.id === (contributionId ?? selected),
    );
    const d = active ? docs.current[active.id] : undefined;
    if (!active || !d || busyRef.current) return;
    const metadataOnly = ["hide", "feature", "delete"].includes(operation);
    const snapshot = docs.current[active.id]!;
    const commandDocument = metadataOnly
      ? {
          ...(bases.current[active.id] ?? snapshot),
          ...(operation === "hide" ? { visible: false } : {}),
        }
      : snapshot;
    const mergeTargetOriginal = duplicateId
      ? docs.current[duplicateId]
      : undefined;
    if (operation === "publish") {
      setValidationProject(active.id);
      const errors = storyValidation(snapshot, {
        publish: true,
        platform: !!active.projectId,
      });
      if (errors.length) {
        const general = errors.filter((error) => !error.imageId);
        setError(
          general.length
            ? general.map((error) => error.message).join(" ")
            : null,
        );
        const first = errors[0]!;
        requestAnimationFrame(() =>
          scrollContributionEditorTarget(
            document.getElementById(
              first.imageId && first.field
                ? `story-${first.field}-${first.imageId}`
                : `contribution-${first.section}`,
            ),
            true,
          ),
        );
        return;
      }
      if (pending.some((p) => p.owner === active.id)) {
        setError("Finish or remove pending images before publishing.");
        return;
      }
    }
    const signature = JSON.stringify({
      id: active.id,
      snapshot,
      operation,
      version: versions.current[active.id],
      linkTarget,
      duplicateId,
    });
    if (request.current?.key !== signature)
      request.current = { key: signature, id: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setStatus(
      operation === "draft" ? "Saving private draft…" : "Saving changes…",
    );
    try {
      const result = await saveContributionStoryAction({
        id: active.id,
        expectedVersion: versions.current[active.id] ?? active.version ?? 1,
        requestId: request.current.id,
        operation,
        document: commandDocument,
        ...(operation === "link"
          ? {
              targetProjectId: linkTarget,
              ...(duplicateId && mergeConsent
                ? { mergeTargetId: duplicateId }
                : {}),
            }
          : {}),
      });
      if (!result.success) {
        setPauseAutosave(true);
        setError(result.error);
        setStatus("Draft save failed");
        if (result.code === "CONFLICT") {
          const latest = (await refresh()).find((r) => r.id === active.id);
          if (latest) setConflict(latest);
        }
        if (result.duplicateId) {
          setDuplicateId(result.duplicateId);
          setLinkOpen(true);
        }
        return;
      }
      setPauseAutosave(false);
      if (result.published) setValidationProject(null);
      request.current = null;
      versions.current[result.id] = result.version;
      if (!metadataOnly) bases.current[result.id] = result.document;
      else if (operation === "hide" && bases.current[result.id])
        bases.current[result.id] = {
          ...bases.current[result.id]!,
          visible: false,
        };
      setDocuments((current) => ({
        ...current,
        [result.id]: metadataOnly
          ? {
              ...current[result.id]!,
              ...(operation === "hide" ? { visible: false } : {}),
            }
          : result.id !== active.id || same(current[active.id], snapshot)
            ? result.document
            : current[active.id]!,
      }));
      setRecords((current) =>
        current.map((r) =>
          r.id === result.id
            ? {
                ...r,
                version: result.version,
                draftStory: result.document,
                featured: result.featured,
                ...(result.published
                  ? {
                      presentation: result.document,
                      visibility: result.document.visible
                        ? ("public" as const)
                        : ("private" as const),
                      publishedAt: new Date().toISOString(),
                    }
                  : {}),
                ...(operation === "hide" || operation === "restore"
                  ? { visibility: "private" as const }
                  : {}),
              }
            : r,
        ),
      );
      if (!metadataOnly && same(docs.current[active.id], snapshot))
        await del(key(active.id), draftStorage()).catch(() => {});
      else
        await set(
          key(active.id),
          {
            document: docs.current[active.id],
            base: result.document,
            version: result.version,
          },
          draftStorage(),
        ).catch(() => {});
      setStatus(
        result.published
          ? "Updates published"
          : operation === "hide"
            ? "Hidden from profile"
            : operation === "feature"
              ? "Pin updated"
              : "Private draft saved",
      );
      channel.current?.postMessage({ id: result.id });
      if (result.removed) {
        const old = active;
        setRecords((current) => current.filter((r) => r.id !== old.id));
        setUndo({
          label: "Contribution removed",
          run: () => {
            setRecords((current) => [old, ...current]);
            nav(old.id);
            versions.current[old.id] = result.version;
            setTimeout(() => void saveRef.current("restore"), 0);
          },
        });
        nav(null);
      }
      if (result.mergedFrom) {
        const merged = result.mergedFrom,
          source = active,
          targetDocument = mergeTargetOriginal,
          sourceDocument = snapshot;
        setUndo({
          label: "Contributions merged into a private draft",
          run: () => {
            void (async () => {
              if (
                !targetDocument ||
                !same(docs.current[merged.targetId], result.document)
              ) {
                setError(
                  "Newer edits are kept. Save or discard them before undoing the merge.",
                );
                return;
              }
              const restored = await saveContributionStoryAction({
                id: source.id,
                expectedVersion: merged.version,
                requestId: crypto.randomUUID(),
                operation: "undo-merge",
                document: sourceDocument,
                mergeRestore: {
                  targetId: merged.targetId,
                  targetVersion: merged.targetVersion,
                  document: targetDocument,
                },
              });
              if (!restored.success) {
                setError(restored.error);
                return;
              }
              bases.current[source.id] = sourceDocument;
              bases.current[merged.targetId] = targetDocument;
              versions.current[source.id] = restored.version;
              versions.current[merged.targetId] = merged.targetVersion + 1;
              setDocuments((current) => ({
                ...current,
                [source.id]: sourceDocument,
                [merged.targetId]: targetDocument,
              }));
              await refresh();
              nav(source.id);
            })();
          },
        });
      }
      if (result.published) await refresh();
      if (operation === "link") {
        setLinkOpen(false);
        setDuplicateId(null);
        setMergeConsent(false);
        await refresh();
        nav(result.id);
      }
      setConfirm(null);
    } catch {
      setPauseAutosave(true);
      setError(
        "Couldn’t save this contribution. Your draft is kept. Retry Save draft.",
      );
      setStatus("Draft save failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  saveRef.current = save;
  async function cancelEditing() {
    if (busyRef.current || pending.length) return;
    try {
      await Promise.all(
        Object.entries(docs.current)
          .filter(([id, document]) => !same(document, bases.current[id]))
          .map(([id, document]) =>
            set(
              key(id),
              {
                document,
                base: bases.current[id],
                version: versions.current[id],
              },
              draftStorage(),
            ),
          ),
      );
      if (onCancel) onCancel();
      else router.push("/my-profile");
    } catch {
      setError(
        "Your latest edits could not be kept locally. Save your draft before leaving.",
      );
    }
  }
  const closeRole = (id: string) => {
    setRoleEdit(null);
    requestAnimationFrame(() =>
      document
        .getElementById(`story-edit-role-${id}`)
        ?.focus({ preventScroll: true }),
    );
  };
  async function addExternal() {
    if (busyRef.current) return;
    setError(null);
    const incomplete = records.find(
      (record) =>
        !record.projectId &&
        !(docs.current[record.id]?.title ?? record.projectTitle).trim(),
    );
    if (incomplete) {
      nav(incomplete.id);
      setStatus(
        "Finish or remove the current external project draft before adding another.",
      );
      return;
    }
    try {
      const result = await createContributionStoryAction();
      if (!result.success) {
        setError(result.error);
        return;
      }
      const page = await refresh();
      const row = page.find((r) => r.id === result.id);
      if (row) {
        const doc = { ...storyFromContribution(row), title: "" };
        bases.current[row.id] = storyFromContribution(row);
        versions.current[row.id] = row.version ?? 1;
        setDocuments((current) => ({ ...current, [row.id]: doc }));
        nav(row.id);
      }
    } catch {
      setError("Couldn’t add an external project. Try again.");
    }
  }
  async function uploadFiles(
    files: File[],
    replaceId: string | null = null,
    ownerId?: string,
  ) {
    const owner = ownerId ?? active?.id;
    const d = owner ? docs.current[owner] : undefined;
    if (!owner || !d) return;
    const available = replaceId
      ? 1
      : Math.max(
          0,
          8 - d.images.length - pending.filter((p) => p.owner === owner).length,
        );
    if (files.length > available)
      setError("You can include up to eight images.");
    for (const selected of files.slice(0, available)) {
      const file = await compressImage(selected, { maxWidth: 1600, maxHeight: 1600 });
      const id = crypto.randomUUID();
      setPending((current) => [...current, { id, owner, replaceId, file }]);
      try {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 10485760
        )
          throw new Error("Use PNG, JPG, or WebP images up to 10 MB.");
        const prepared = await createContributionImageUploadAction(
          owner,
          file.type,
          file.size,
        );
        const sent = await fetch(prepared.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!sent.ok) throw new Error("Upload interrupted. Retry this image.");
        const uploaded = await finalizeContributionImageAction(
          owner,
          prepared.uploadIntentId,
        );
        if (cancelledUploads.current.has(id)) continue;
        patch(owner, (doc) => {
          if (replaceId && !doc.images.some((i) => i.id === replaceId))
            return doc;
          if (!replaceId && doc.images.length >= 8) return doc;
          const image = {
            id: replaceId ?? crypto.randomUUID(),
            assetId: uploaded.assetId,
            caption: "",
            alt: "",
            positionId: null,
            projectFileId: null,
            permission: true,
          };
          return {
            ...doc,
            images: replaceId
              ? doc.images.map((i) =>
                  i.id === replaceId
                    ? {
                        ...i,
                        assetId: uploaded.assetId,
                        alt: "",
                        projectFileId: null,
                        permission: true,
                      }
                    : i,
                )
              : [...doc.images, image],
            coverId: doc.coverId ?? image.id,
          };
        });
        setPending((current) => current.filter((p) => p.id !== id));
      } catch (error) {
        setPending((current) =>
          current.map((p) =>
            p.id === id
              ? {
                  ...p,
                  error:
                    error instanceof Error ? error.message : "Upload failed.",
                }
              : p,
          ),
        );
      }
    }
  }
  const rolePatch = (id: string, changes: Partial<StoryPosition>) =>
    active &&
    patch(active.id, (doc) => ({
      ...doc,
      ...(changes.current ? { current: true, end: "" } : {}),
      positions: doc.positions.map((p) =>
        p.id === id
          ? { ...p, ...changes }
          : changes.current
            ? { ...p, current: false }
            : p,
      ),
    }));
  const filtered = records
    .filter((r) => {
      const doc = documents[r.id];
      return (
        (!search ||
          `${r.projectTitle} ${doc?.title ?? ""} ${doc?.summary ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (filter === "all" ||
          (filter === "public"
            ? r.visibility === "public"
            : r.visibility !== "public"))
      );
    })
    .sort((a, b) => {
      if (Number(b.featured) !== Number(a.featured)) {
        return Number(b.featured) - Number(a.featured);
      }
      const docA = documents[a.id];
      const docB = documents[b.id];
      const dateA =
        docA?.start ||
        sortedStoryPositions(docA?.positions ?? [])[0]?.start ||
        a.startDate ||
        a.createdAt ||
        "";
      const dateB =
        docB?.start ||
        sortedStoryPositions(docB?.positions ?? [])[0]?.start ||
        b.startDate ||
        b.createdAt ||
        "";
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const createdA = a.projectCreatedAt || a.createdAt || "";
      const createdB = b.projectCreatedAt || b.createdAt || "";
      if (createdA !== createdB) return createdB.localeCompare(createdA);
      return b.id.localeCompare(a.id);
    });
  const footer =
    active && d ? (
      <footer
        data-contribution-actions
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] md:px-[calc(var(--ui-panel-padding)+4px)]"
      >
        <div role="status" aria-live="polite">
          <p className="nb-compact">
            {busy
              ? "Saving…"
              : pauseAutosave
                ? "Draft not saved. Retry Save draft."
                : status}
          </p>
          <p className="nb-compact text-muted-foreground">
            Visitors see your last published version.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void save("draft")}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || pending.length > 0}
            onClick={() => void cancelEditing()}
          >
            Cancel
          </Button>
          {/* Live-fix 63: an entry that isn't on the profile yet can always be published; checks list what's missing. */}
          {(hasPublishChanges || (!!active && !active.publishedAt && !active.presentation)) && (
            <Button
              type="button"
              disabled={busy}
              className="h-8 pointer-coarse:h-11 rounded-[6px] bg-primary hover:bg-primary-hover px-3 text-xs text-primary-foreground"
              onClick={() => void save("publish")}
            >
              <Globe className="mr-1.5 size-3.5" />
              Publish updates
            </Button>
          )}
        </div>
      </footer>
    ) : null;
  if (active && !d)
    return (
      <div className="nb-contribution-editor">
        <Button type="button" variant="ghost" onClick={() => nav(null)}>
          <ArrowLeft className="size-4" />
          Contributions
        </Button>
        <p role="status" className="nb-compact py-8">
          Loading contribution…
        </p>
      </div>
    );
  return (
    <div className="nb-contribution-editor">
      {error && (
        <div
          role="alert"
          tabIndex={-1}
          className="mb-5 rounded-[5px] border border-destructive/30 bg-destructive/5 p-3 nb-compact text-destructive"
        >
          {error}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void save("draft")}
            disabled={!active || busy}
          >
            Retry save
          </Button>
        </div>
      )}
      {undo && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 nb-compact"
        >
          {undo.label}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {!active || !d ? (
        <>
          <div className="mb-5 flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
              <h1 className="nb-page-title text-balance">Contributions</h1>
              <p className="nb-body mt-1 text-pretty text-muted-foreground">
                Tell the story behind your work. Choose what appears on your
                profile.
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger
                  aria-label="Filter contributions"
                  className="w-auto min-w-[136px] bg-card pointer-coarse:h-11"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All contributions</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
              <SearchField
                label="Search contributions"
                value={search}
                onChange={setSearch}
                pageSearch
                className="flex-1 basis-40 sm:w-64 sm:flex-none sm:basis-auto"
              />
              <Button
                type="button"
                variant="outline"
                className="bg-card max-sm:w-full pointer-coarse:h-11"
                onClick={() => void addExternal()}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add external project
              </Button>
            </div>
          </div>
          <div className="divide-y divide-border">
            {/* Live-fix 57, 66: grouped like the profile, an organization's workspaces nested under it. */}
            {(() => {
              const g = groupProfileContributions(filtered, true);
              const groups: Array<[string, Array<Item & { children?: Item[] }>]> = [["Organizations", g.organizations], ["Workspaces", g.workspaces], ["Not on your profile yet", g.drafts], ["Private to you", g.privateToYou]];
              const row = (r: Item, nested: boolean) => {
                const doc = documents[r.id];
                return (
                  <article key={r.id} className={nested ? "border-l-2 border-border py-5 pl-4 ml-2" : "py-5"}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="nb-card-title break-words text-left hover:underline"
                          onClick={() => nav(r.id)}
                        >
                          {r.projectId
                            ? r.projectTitle
                            : doc?.title || r.projectTitle}
                          {r.featured && (
                            <Pin className="ml-2 inline size-3.5 text-primary" />
                          )}
                        </button>
                        <p className="nb-compact mt-1 text-muted-foreground">
                          {doc?.positions.find((p) => !p.hidden)?.title ||
                            r.title}
                        </p>
                        <p className="nb-meta mt-1 text-muted-foreground">
                          {doc && storyPeriod(doc)}
                        </p>
                        <div className="mt-2">
                          <ContributionIdentityLinks
                            links={[
                              ...(r.projectIdentityLinks ?? []),
                              ...(doc?.links ?? []),
                            ]}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {/* Report §16.10, §38.3: Published, Draft, Hidden, Left, Completed or Private to you. */}
                        <span className="nb-micro text-muted-foreground" data-testid="editor-entry-status">
                          {editorEntryStatus(r)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${r.projectTitle}`}
                          onClick={() => nav(r.id)}
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                      </div>
                    </div>
                    {doc?.summary && (
                      <p className="nb-compact mt-3 line-clamp-2 text-muted-foreground">
                        {/* Live-fix 60: mentions read as their names; Markdown marks and escapes drop out. */}
                        {previewText(doc.summary, r.resolvedReferences ?? [])}
                      </p>
                    )}
                  </article>
                );
              };
              return groups.filter(([, rows]) => rows.length).map(([title, rows]) => (
                <section key={title} aria-label={title}>
                  <h3 className="nb-micro pt-5 text-muted-foreground">{title}</h3>
                  {rows.flatMap((p) => [row(p, false), ...(p.children ?? []).map((c) => row(c, true))])}
                </section>
              ));
            })()}
          </div>
          {!filtered.length && (
            <div className="nb-empty-state nb-grid-ground rounded-lg py-12 text-center">
              <h3 className="nb-card-title">
                {search
                  ? "No matching contributions"
                  : "No workspace contributions yet"}
              </h3>
              <p className="nb-compact mt-2 text-muted-foreground">
                {search
                  ? "Try a different search."
                  : "Contributions appear when you join a workspace. You can also add an external project."}
              </p>
            </div>
          )}
          {hasMore && (
            <Button
              type="button"
              variant="outline"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore
                ? "Loading contributions…"
                : "Load more contributions"}
            </Button>
          )}
        </>
      ) : (
        <>
          {/* Redesigned Detail Header matching NetworkBase specifications */}
          <header className="mb-6 border-b border-border pb-6">
            {/* Top Row: Navigation Return Path */}
            <div className="mb-4 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => nav(null)}
                className="-ml-2 h-8 gap-1.5 rounded-[6px] px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-3.5" aria-hidden="true" />
                Back to contributions
              </Button>
            </div>

            {/* Title, Badge, Description, and Action Controls */}
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="nb-section-title text-foreground">
                    {active.projectId
                      ? active.projectTitle
                      : d.title || "Untitled external project"}
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded-[4px] border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {setByTitle ? (
                      <>
                        <ShieldCheck className="size-3 text-primary" aria-hidden="true" />
                        {`Set by ${setByTitle}`}{active.orgVerified ? ` · ✓ Verified by ${setByTitle}` : " · Not verified yet"}
                      </>
                    ) : active.projectId ? (
                      <>
                        <ShieldCheck className="size-3 text-primary" aria-hidden="true" />
                        Linked NetworkBase workspace
                      </>
                    ) : (
                      "External project · self-reported"
                    )}
                  </span>
                </div>
                <p className="nb-compact text-muted-foreground">
                  {active.projectId
                    ? "Tell the story behind your contributions, roles, and highlights for this workspace."
                    : "Tell the story behind your work on this external project."}
                </p>
              </div>

              {/* Action Controls */}
              <div className="flex flex-wrap items-center gap-2 pt-1 md:pt-0 shrink-0">
                <div className="flex items-center gap-2 rounded-[6px] border border-border bg-card px-2.5 py-1.5 shadow-2xs">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    Show on profile
                  </span>
                  <SettingsSwitch
                    aria-label="Show this contribution on profile"
                    checked={d.visible}
                    disabled={
                      ((active.projectVisibility === "private" ||
                        ["draft", "deleted"].includes(active.projectStatus ?? "")) &&
                        !d.visible) ||
                      busy
                    }
                    onCheckedChange={(checked) => {
                      if (
                        checked &&
                        active.projectVisibility === "unlisted" &&
                        !d.allowUnlisted
                      ) {
                        setConsent(false);
                        setConfirm("unlisted");
                      } else {
                        patch(active.id, { visible: checked });
                        if (!checked) {
                          docs.current[active.id] = { ...d, visible: false };
                          void save("hide");
                        }
                      }
                    }}
                  />
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-[6px] px-3 text-xs font-medium"
                  onClick={() => setPreview("draft")}
                >
                  <Eye className="mr-1.5 size-3.5" aria-hidden="true" />
                  Preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-[6px] px-3 text-xs font-medium"
                  onClick={() => setPreview("visitor")}
                >
                  View as visitor
                </Button>
              </div>
            </div>
          </header>

          {/* In-page Anchor Sub-Navigation Tabs */}
          <nav
            aria-label="Contribution sections"
            className="nb-tabs-list mb-8 flex min-h-10 w-full items-center gap-6 border-b border-border overflow-x-auto"
          >
            {[
              ...(!active.projectId ? [["identity", "Workspace"]] : []),
              ["summary", "Summary"],
              ["positions", "Roles and dates"],
              ["work", "Work samples"],
              ["skills", "Skills and links"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="nb-tab inline-flex min-h-10 pointer-coarse:min-h-11 shrink-0 items-center justify-center border-b-2 border-transparent px-1 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground active:text-foreground"
                onClick={() =>
                  scrollContributionEditorTarget(
                    document.getElementById(`contribution-${id}`),
                  )
                }
              >
                {label}
              </button>
            ))}
          </nav>
          {!active.projectId && (
            <section className="nb-story-section" id="contribution-identity">
              <h3 className="nb-section-title">Workspace</h3>
              <Field label="Workspace name">
                <input
                  className="nb-story-input"
                  maxLength={120}
                  value={d.title}
                  onChange={(e) => patch(active.id, { title: e.target.value })}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLinkOpen(true)}
              >
                <Link2 className="size-3.5" />
                Link to a workspace
              </Button>
            </section>
          )}
          {active.endReason === "removed" ? (
            // Report §4.6, §38.5: after a removal the entry is the person's alone; the server refuses to publish it.
            <p role="note" className="mb-6 rounded-[6px] border border-border bg-muted/40 p-3 nb-compact text-muted-foreground">
              Private to you. You were removed from {active.parentOrg?.title ?? active.projectTitle}, so this can’t be published. Your words are kept until you delete them.
            </p>
          ) : null}
          <section className="nb-story-section" id="contribution-summary">
            <h3 className="nb-section-title">Your contribution</h3>
            <p className="nb-compact mt-1 mb-5 text-muted-foreground">
              {isOrgEntry ? "Explain your part in the organization, in your own words." : "Explain your part in the workspace, in your own words."}
            </p>
            {active.projectKind === "organization" ? (
              <OrgStoryHelpers
                contributionId={active.id}
                canStartFromAbout={active.membershipRole === "owner" || active.membershipRole === "admin"}
                showWorkRecord={d.showWorkRecord ?? Boolean(active.showWorkRecord)}
                onWorkRecordChange={(showWorkRecord) => patch(active.id, { showWorkRecord })}
                onInsert={(text) => patch(active.id, { summary: d.summary.trim() ? `${d.summary.trim()}\n\n${text}` : text })}
              />
            ) : null}
            <ContributionSummaryEditor
              key={active.id}
              value={d.summary}
              onChange={(summary) => patch(active.id, { summary })}
              references={references}
              searchReferences={(kind, query) =>
                searchContributionReferencesAction(active.id, kind, query)
              }
              onReferenceSelected={(option) =>
                setReferences((current) => [
                  ...current.filter(
                    (reference) =>
                      !(
                        reference.kind === option.kind &&
                        reference.id === option.id
                      ),
                  ),
                  option,
                ])
              }
              fileCount={active.fileContributionCount ?? 0}
              projectId={active.projectId}
            />
          </section>
          <section className="nb-story-section" id="contribution-positions">
            {/* Decision 104: organization entries, and workspaces inside one, take role and dates from the record. */}
            <h3 className="nb-section-title">Roles and dates</h3>
            <p className="nb-compact mt-1 mb-5 text-muted-foreground">
              {recordLocked ? (
                <>
                  Role and dates come from the organization’s records.{" "}
                  {/* Members → Admins lists who to ask (report §29.6); a former member sees the organization's own page. */}
                  {adminsHref ? <a href={adminsHref} className="text-primary underline underline-offset-2">Ask an admin</a> : "Ask an admin"} if they’re wrong.
                </>
              ) : "Show how your contribution evolved over time."}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-[140px_auto_140px_1fr] items-center gap-2.5 rounded-[6px] border border-border/70 bg-muted/20 p-2.5">
              <input
                type="month"
                aria-label="Started contributing"
                max={new Date().toISOString().slice(0, 7)}
                value={d.start}
                disabled={recordLocked}
                onChange={(e) => patch(active.id, { start: e.target.value })}
                className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2.5 sm:text-xs text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs text-muted-foreground text-center">to</span>
              <input
                type="month"
                aria-label="Finished contributing"
                min={d.start || undefined}
                max={new Date().toISOString().slice(0, 7)}
                value={d.current ? "" : d.end}
                disabled={d.current || recordLocked}
                placeholder={d.current ? "Present" : "End month"}
                onChange={(e) => patch(active.id, { end: e.target.value })}
                className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2.5 sm:text-xs text-base text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <label className="flex items-center gap-2 pl-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={d.current}
                  disabled={recordLocked}
                  onChange={(e) =>
                    patch(active.id, {
                      current: e.target.checked,
                      end: e.target.checked ? "" : d.end,
                    })
                  }
                  className="size-4 rounded-[4px] border-border text-[#D14E24] focus:ring-[#D14E24]"
                />
                <span>{isOrgEntry ? "I’m currently in this organization" : "I currently contribute to this workspace"}</span>
              </label>
            </div>
            {recordLocked ? null : (
              <p className="nb-compact mt-1.5 text-muted-foreground">
                Clearing this also marks your positions as no longer current. End
                dates can stay blank.
              </p>
            )}
            {active.projectId && (
              <p className="nb-compact mt-3 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Recorded join: {storyMonth(active.recordedJoinedAt ?? "")} ·
                Team access: {active.membershipRole || active.roleKind}
              </p>
            )}
            {positionDuration(d.positions) && (
              <p className="nb-compact mt-2 text-muted-foreground">
                Positions cover {positionDuration(d.positions)}. Overlapping
                periods are counted once.
              </p>
            )}
            <div className="mt-6 border-t border-border pt-6">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h4 className="nb-card-title">Role history</h4>
                  <span className="nb-meta text-muted-foreground">
                    {roleCount(d.positions.length)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={d.positions.length >= 20}
                  onClick={() => {
                    const id = crypto.randomUUID();
                    patch(active.id, (doc) => ({
                      ...doc,
                      positions: [
                        {
                          id,
                          recordedStageId: null,
                          title: "",
                          start: "",
                          end: "",
                          current: false,
                          description: "",
                          hidden: false,
                        },
                        ...doc.positions,
                      ],
                    }));
                    setRoleEdit(id);
                  }}
                >
                  <Plus className="size-4" />
                  Add position
                </Button>
              </div>
              <div
                role="list"
                aria-label="Role history"
                className="divide-y divide-border"
              >
                {d.positions.map((role) => {
                  const recorded = active.roleStages?.find(
                    (s) => s.id === role.recordedStageId,
                  );
                  // Decision 104: a step from the record keeps its name and dates; detail stays yours.
                  const stepLocked = recordLocked && Boolean(role.recordedStageId);
                  return (
                    <div
                      key={role.id}
                      role="listitem"
                      className="nb-story-position py-6"
                    >
                      <p className="nb-meta pt-1 text-muted-foreground">
                        {storyPeriod(role)}
                      </p>
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h4 className="nb-card-title break-words">
                              {role.title || "New position"}
                            </h4>
                            {role.current && (
                              <span className="nb-story-current">Current</span>
                            )}
                            {role.hidden && (
                              <span className="nb-compact text-muted-foreground">
                                Hidden from profile
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            id={`story-edit-role-${role.id}`}
                            aria-label={`Edit position ${role.title || "new position"}`}
                            aria-expanded={roleEdit === role.id}
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              roleEdit === role.id
                                ? closeRole(role.id)
                                : setRoleEdit(role.id)
                            }
                          >
                            {roleEdit === role.id ? (
                              <X className="size-3.5" />
                            ) : (
                              <Pencil className="size-3.5" />
                            )}
                            {roleEdit === role.id ? "Close" : "Edit"}
                          </Button>
                        </div>
                        {roleEdit !== role.id && role.description && (
                          <p className="nb-compact mt-2 whitespace-pre-wrap text-muted-foreground">
                            {role.description}
                          </p>
                        )}
                        <p className="nb-compact mt-3 flex items-center gap-1.5 text-muted-foreground">
                          {role.recordedStageId ? (
                            <ShieldCheck className="size-3.5" />
                          ) : null}
                          {recorded
                            ? recorded.roleTitle === role.title
                              ? "From team records"
                              : `Personal title · recorded position: ${recorded.roleTitle}`
                            : role.recordedStageId
                              ? "From team records"
                              : "Position described by you"}
                        </p>
                        {roleEdit === role.id && (
                          <div
                            role="region"
                            aria-label={`Edit ${role.title || "new position"}`}
                            className="mt-5 space-y-4"
                          >
                            <Field label="Position title">
                              <input
                                id={`story-role-title-${role.id}`}
                                className="nb-story-input disabled:opacity-60"
                                maxLength={120}
                                value={role.title}
                                disabled={stepLocked}
                                onChange={(e) =>
                                  rolePatch(role.id, { title: e.target.value })
                                }
                              />
                            </Field>
                            {!stepLocked && recorded && recorded.roleTitle !== role.title && (
                              <button
                                type="button"
                                className="nb-touch-target nb-compact text-primary"
                                onClick={() =>
                                  rolePatch(role.id, {
                                    title: recorded.roleTitle,
                                  })
                                }
                              >
                                Restore recorded title
                              </button>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-[140px_auto_140px_1fr] items-center gap-2 rounded-[6px] border border-border/60 bg-muted/20 p-2">
                              <input
                                type="month"
                                aria-label="Start month"
                                className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2 sm:text-xs text-base disabled:opacity-50"
                                max={new Date().toISOString().slice(0, 7)}
                                value={role.start}
                                disabled={stepLocked}
                                onChange={(e) =>
                                  rolePatch(role.id, {
                                    start: e.target.value,
                                  })
                                }
                              />
                              <span className="text-xs text-muted-foreground text-center">to</span>
                              <input
                                type="month"
                                aria-label="End month"
                                className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2 sm:text-xs text-base disabled:opacity-50"
                                max={new Date().toISOString().slice(0, 7)}
                                min={role.start || undefined}
                                disabled={role.current || stepLocked}
                                placeholder={role.current ? "Present" : "End month"}
                                value={role.current ? "" : role.end}
                                onChange={(e) =>
                                  rolePatch(role.id, { end: e.target.value })
                                }
                              />
                              <label className="flex items-center gap-2 pl-2 text-xs text-muted-foreground cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={role.current}
                                  disabled={stepLocked}
                                  onChange={(e) =>
                                    rolePatch(role.id, {
                                      current: e.target.checked,
                                      end: e.target.checked ? "" : role.end,
                                    })
                                  }
                                  className="size-4 rounded-[4px] border-border text-primary focus:ring-ring"
                                />
                                <span>I currently hold this position</span>
                              </label>
                            </div>
                            <p className="nb-compact text-muted-foreground">
                              A current position also marks this workspace as
                              ongoing.
                            </p>
                            <Field
                              label="Responsibilities and outcomes"
                              help="Optional. Describe this period without repeating the whole workspace summary."
                            >
                              <textarea
                                className="nb-story-input min-h-28"
                                maxLength={2000}
                                value={role.description}
                                onChange={(e) =>
                                  rolePatch(role.id, {
                                    description: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <button
                                type="button"
                                className="nb-touch-target nb-compact text-destructive"
                                onClick={() => {
                                  const index = d.positions.findIndex(
                                      (p) => p.id === role.id,
                                    ),
                                    images = d.images
                                      .filter((i) => i.positionId === role.id)
                                      .map((i) => i.id);
                                  patch(active.id, (doc) =>
                                    removeStoryPosition(doc, role.id),
                                  );
                                  if (!role.recordedStageId) {
                                    setRoleEdit(null);
                                    setUndo({
                                      label: "Position removed",
                                      run: () =>
                                        patch(active.id, (doc) => ({
                                          ...doc,
                                          positions: [
                                            ...doc.positions.slice(0, index),
                                            role,
                                            ...doc.positions.slice(index),
                                          ],
                                          images: doc.images.map((i) =>
                                            images.includes(i.id) &&
                                            !i.positionId
                                              ? { ...i, positionId: role.id }
                                              : i,
                                          ),
                                        })),
                                    });
                                  }
                                }}
                              >
                                {role.recordedStageId
                                  ? role.hidden
                                    ? "Show on profile"
                                    : "Hide from profile"
                                  : "Remove position"}
                              </button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => closeRole(role.id)}
                              >
                                <Check className="size-3.5" />
                                Done
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="nb-compact mt-3 flex items-start gap-2 text-muted-foreground">
                <Info className="size-3.5 shrink-0 mt-0.5" />
                Personal position titles never change team access or
                permissions.
              </p>
            </div>
          </section>
          <section
            className="nb-story-section"
            id="contribution-work"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length) {
                e.preventDefault();
                void uploadFiles(files);
              }
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="nb-section-title">
                  Images and work examples{" "}
                  <span className="nb-meta ml-2 text-muted-foreground">
                    {d.images.length} / 8
                  </span>
                </h3>
                <p className="nb-compact mt-1 text-muted-foreground">
                  Give people a closer look at your contribution.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!active.projectId || d.images.length >= 8}
                onClick={() => {
                  setQuery("");
                  setPicker({ kind: "file", images: true });
                }}
              >
                <FileText className="size-3.5" />
                From workspace
              </Button>
            </div>
            <input
              type="file"
              ref={uploadInput}
              accept="image/png,image/jpeg,image/webp"
              multiple={!replacement.current}
              className="hidden"
              tabIndex={-1}
              aria-label="Upload contribution images"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []),
                  replace = replacement.current;
                replacement.current = null;
                e.target.value = "";
                requestAnimationFrame(() =>
                  uploadTrigger.current?.focus({ preventScroll: true }),
                );
                void uploadFiles(files, replace);
              }}
            />
            <div className="mt-5 grid grid-cols-1 gap-4 @min-[540px]:grid-cols-2">
              {d.images.map((image, index) => (
                <div
                  key={image.id}
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "application/x-networkbase-contribution-image",
                      image.id,
                    )
                  }
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer.types.includes(
                        "application/x-networkbase-contribution-image",
                      )
                    )
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    const imageId = event.dataTransfer.getData(
                      "application/x-networkbase-contribution-image",
                    );
                    if (!imageId) return;
                    event.preventDefault();
                    event.stopPropagation();
                    patch(active.id, (doc) => {
                      const from = doc.images.findIndex(
                          (item) => item.id === imageId,
                        ),
                        to = doc.images.findIndex(
                          (item) => item.id === image.id,
                        );
                      if (from < 0 || to < 0) return doc;
                      const images = [...doc.images];
                      const [moved] = images.splice(from, 1);
                      images.splice(to, 0, moved!);
                      return { ...doc, images };
                    });
                  }}
                  className="min-w-0 overflow-hidden rounded-[5px] border border-border"
                >
                  <button
                    type="button"
                    className="w-full bg-muted/20"
                    onClick={() => setPreview("draft")}
                    aria-label={`Preview image ${index + 1}`}
                  >
                    <img
                      className="h-44 w-full object-contain"
                      src={`/api/v1/contribution-images/${image.assetId}`}
                      alt={image.alt || "Draft work example"}
                    />
                  </button>
                  <div className="space-y-3 p-3">
                    <Field label="Caption">
                      <input
                        className="nb-story-input"
                        maxLength={500}
                        value={image.caption}
                        onChange={(e) =>
                          patch(active.id, (doc) => ({
                            ...doc,
                            images: doc.images.map((i) =>
                              i.id === image.id
                                ? { ...i, caption: e.target.value }
                                : i,
                            ),
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label="Image description"
                      help="Required to publish. This description also appears below the published image."
                      helpId={`story-image-description-help-${image.id}`}
                      errorId={`story-image-description-error-${image.id}`}
                      error={
                        validationIssues.find(
                          (issue) =>
                            issue.imageId === image.id &&
                            issue.field === "image-description",
                        )?.message
                      }
                    >
                      <textarea
                        id={`story-image-description-${image.id}`}
                        aria-required="true"
                        aria-invalid={
                          validationIssues.some(
                            (issue) =>
                              issue.imageId === image.id &&
                              issue.field === "image-description",
                          ) || undefined
                        }
                        aria-describedby={cn(
                          `story-image-description-help-${image.id}`,
                          validationIssues.some(
                            (issue) =>
                              issue.imageId === image.id &&
                              issue.field === "image-description",
                          ) && `story-image-description-error-${image.id}`,
                        )}
                        className="nb-story-input scroll-mt-5"
                        maxLength={500}
                        value={image.alt}
                        onChange={(e) =>
                          patch(active.id, (doc) => ({
                            ...doc,
                            images: doc.images.map((i) =>
                              i.id === image.id
                                ? { ...i, alt: e.target.value }
                                : i,
                            ),
                          }))
                        }
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 pointer-coarse:h-11 px-2 text-xs rounded-[4px]"
                        aria-label={`Move image ${index + 1} earlier`}
                        disabled={index === 0}
                        onClick={() =>
                          patch(active.id, (doc) => {
                            const a = [...doc.images];
                            [a[index - 1], a[index]] = [
                              a[index]!,
                              a[index - 1]!,
                            ];
                            return { ...doc, images: a };
                          })
                        }
                      >
                        <ArrowUp className="size-3.5 mr-1" /> Earlier
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 pointer-coarse:h-11 px-2 text-xs rounded-[4px]"
                        aria-label={`Move image ${index + 1} later`}
                        disabled={index === d.images.length - 1}
                        onClick={() =>
                          patch(active.id, (doc) => {
                            const a = [...doc.images];
                            [a[index + 1], a[index]] = [
                              a[index]!,
                              a[index + 1]!,
                            ];
                            return { ...doc, images: a };
                          })
                        }
                      >
                        <ArrowDown className="size-3.5 mr-1" /> Later
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={d.coverId === image.id ? "secondary" : "ghost"}
                        className="h-7 pointer-coarse:h-11 px-2 text-xs rounded-[4px]"
                        onClick={() => patch(active.id, { coverId: image.id })}
                      >
                        {d.coverId === image.id ? "★ Cover image" : "Set cover"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 pointer-coarse:h-11 px-2 text-xs rounded-[4px]"
                        aria-label={`Replace image ${index + 1}`}
                        onClick={(event) => {
                          uploadTrigger.current = event.currentTarget;
                          replacement.current = image.id;
                          uploadInput.current?.click();
                        }}
                      >
                        <RotateCcw className="size-3.5 mr-1" /> Replace
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 pointer-coarse:h-11 px-2 text-xs rounded-[4px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove image ${index + 1}`}
                        onClick={() => {
                          const wasCover = d.coverId === image.id;
                          patch(active.id, (doc) => ({
                            ...doc,
                            images: doc.images.filter((i) => i.id !== image.id),
                            coverId: wasCover
                              ? (doc.images.find((i) => i.id !== image.id)
                                  ?.id ?? null)
                              : doc.coverId,
                          }));
                          setUndo({
                            label: "Image removed",
                            run: () =>
                              patch(active.id, (doc) =>
                                doc.images.length >= 8
                                  ? doc
                                  : {
                                      ...doc,
                                      images: [
                                        ...doc.images.slice(0, index),
                                        image,
                                        ...doc.images.slice(index),
                                      ],
                                      coverId: wasCover
                                        ? image.id
                                        : doc.coverId,
                                    },
                              ),
                          });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Field label="Link to a role">
                      <select
                        className="nb-story-input"
                        value={image.positionId ?? ""}
                        onChange={(e) =>
                          patch(active.id, (doc) => ({
                            ...doc,
                            images: doc.images.map((i) =>
                              i.id === image.id
                                ? { ...i, positionId: e.target.value || null }
                                : i,
                            ),
                          }))
                        }
                      >
                        <option value="">Whole contribution</option>
                        {d.positions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title || "New position"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {image.projectFileId && (
                      <label className="nb-story-check">
                        <input
                          id={`story-image-permission-${image.id}`}
                          type="checkbox"
                          aria-invalid={
                            validationIssues.some(
                              (issue) =>
                                issue.imageId === image.id &&
                                issue.field === "image-permission",
                            ) || undefined
                          }
                          aria-describedby={
                            validationIssues.some(
                              (issue) =>
                                issue.imageId === image.id &&
                                issue.field === "image-permission",
                            )
                              ? `story-image-permission-error-${image.id}`
                              : undefined
                          }
                          checked={image.permission}
                          onChange={(e) =>
                            patch(active.id, (doc) => ({
                              ...doc,
                              images: doc.images.map((i) =>
                                i.id === image.id
                                  ? { ...i, permission: e.target.checked }
                                  : i,
                              ),
                            }))
                          }
                        />
                        I have permission to publish this workspace image.
                        {validationIssues.find(
                          (issue) =>
                            issue.imageId === image.id &&
                            issue.field === "image-permission",
                        ) && (
                          <span
                            id={`story-image-permission-error-${image.id}`}
                            role="alert"
                            className="text-destructive"
                          >
                            Confirm permission to publish this image.
                          </span>
                        )}
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {pending
              .filter((p) => p.owner === active.id)
              .map((p) => (
                <div
                  key={p.id}
                  className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[5px] border border-border p-3 nb-compact"
                >
                  <span>
                    {p.file.name} · {p.error || "Uploading…"}
                  </span>
                  <div>
                    {p.error && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPending((current) =>
                            current.filter((i) => i.id !== p.id),
                          );
                          void uploadFiles([p.file], p.replaceId, p.owner);
                        }}
                      >
                        Retry image
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        cancelledUploads.current.add(p.id);
                        setPending((current) =>
                          current.filter((i) => i.id !== p.id),
                        );
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            <div
              className="mt-5 rounded-[5px] border border-dashed border-border p-6 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void uploadFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <Button
                type="button"
                variant="ghost"
                disabled={
                  d.images.length +
                    pending.filter((p) => p.owner === active.id).length >=
                  8
                }
                onClick={(event) => {
                  uploadTrigger.current = event.currentTarget;
                  replacement.current = null;
                  uploadInput.current?.click();
                }}
              >
                <Upload className="size-4" />
                Choose images
              </Button>
              <p className="nb-compact mt-1 text-muted-foreground">
                or drop them here. You can paste images into this section too.
              </p>
              <p className="nb-meta mt-2 text-muted-foreground">
                PNG, JPG, WebP · 10 MB each
              </p>
            </div>
          </section>
          <section className="nb-story-section" id="contribution-skills">
            <h3 className="nb-section-title">Skills and supporting links</h3>
            <div className="mt-5">
              <SkillPicker
                value={d.skills}
                onChange={(skills) => patch(active.id, { skills })}
                maxSkills={20}
                label="Skills used"
              />
            </div>
            <p className="nb-compact mt-3 text-muted-foreground">
              Skills are chosen by you. Team updates won’t replace this
              selection.
            </p>
            <div className="mt-5 space-y-2">
              {d.links.map((link, index) => (
                <div
                  key={link.id + ":" + index}
                  className="grid grid-cols-1 sm:grid-cols-[180px_1fr_36px] items-center gap-2"
                >
                  <input
                    aria-label={`Link ${index + 1} label`}
                    className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2.5 sm:text-xs text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Label (e.g. Demo, Case Study)"
                    maxLength={80}
                    value={link.label}
                    onChange={(e) =>
                      patch(active.id, (doc) => ({
                        ...doc,
                        links: doc.links.map((l, n) =>
                          n === index ? { ...l, label: e.target.value } : l,
                        ),
                      }))
                    }
                  />
                  <input
                    type="url"
                    aria-label={`Link ${index + 1} URL`}
                    className="h-8 pointer-coarse:h-11 rounded-[4px] border border-border bg-background px-2.5 sm:text-xs text-base text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="https://example.com"
                    maxLength={2048}
                    value={link.url}
                    onChange={(e) =>
                      patch(active.id, (doc) => ({
                        ...doc,
                        links: doc.links.map((l, n) =>
                          n === index ? { ...l, url: e.target.value } : l,
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove link ${index + 1}`}
                    className="h-8 w-8 p-0 rounded-[4px] text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      patch(active.id, (doc) => ({
                        ...doc,
                        links: doc.links.filter((_, n) => n !== index),
                      }))
                    }
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={d.links.length >= 8}
              onClick={() =>
                patch(active.id, (doc) => ({
                  ...doc,
                  links: [
                    ...doc.links,
                    { id: crypto.randomUUID(), label: "", url: "" },
                  ],
                }))
              }
            >
              <Plus className="size-3.5" />
              Add supporting link
            </Button>
          </section>
          <div className="mb-6 flex flex-wrap gap-2">
            {active.presentation && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  const previous = d;
                  patch(active.id, active.presentation!);
                  setUndo({
                    label: "Published version restored to your private draft",
                    run: () => patch(active.id, previous),
                  });
                }}
              >
                <RotateCcw className="size-3.5" />
                Restore published version
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void save("feature")}
            >
              <Pin className="size-3.5" />
              {active.featured ? "Unpin contribution" : "Feature on profile / Featured"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const blob = new Blob(
                  [
                    JSON.stringify(
                      { project: active.projectTitle, document: d },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                saveBlob(blob, "project-contribution.json");
              }}
            >
              <Download className="size-3.5" />
              Export contribution
            </Button>
            {!active.projectId && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirm("delete")}
              >
                <Trash2 className="size-3.5" />
                Remove contribution
              </Button>
            )}
          </div>
          {footerContainer ? createPortal(footer, footerContainer) : footer}
        </>
      )}
      <Dialog
        open={!!picker}
        onOpenChange={(open) => {
          if (!open) {
            picker?.onCancel?.();
            setPicker(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden">
          <DialogTitle>
            {picker?.images
              ? "Choose a workspace image"
              : `Mention a ${picker?.kind ?? "teammate"}`}
          </DialogTitle>
          <DialogDescription>
            Only public teammates and publicly accessible workspace items can be
            included. Mentioning someone sends no notification.
          </DialogDescription>
          <input
            className="nb-story-input"
            aria-label="Search references"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                document
                  .querySelector<HTMLButtonElement>(
                    '[aria-label="Available references"] [role="option"]',
                  )
                  ?.focus();
              }
            }}
          />
          <div
            className="min-h-0 overflow-auto"
            role="listbox"
            aria-label="Available references"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              const options = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="option"]',
                ),
              );
              const index = options.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length;
              event.preventDefault();
              options[next]?.focus();
            }}
          >
            {optionsLoading ? (
              <p className="nb-compact p-3">Loading…</p>
            ) : (
              options
                .filter(
                  (o) =>
                    !picker?.images ||
                    ["image/png", "image/jpeg", "image/webp"].includes(
                      (o as { mimeType?: string }).mimeType ?? "",
                    ),
                )
                .map((option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    key={option.id}
                    className="nb-touch-target block w-full rounded-[5px] p-3 text-left nb-compact hover:bg-muted"
                    onClick={async () => {
                      if (picker?.images && active) {
                        try {
                          const result =
                            await importContributionWorkspaceImageAction(
                              active.id,
                              option.id,
                            );
                          patch(active.id, (doc) =>
                            doc.images.length >= 8
                              ? doc
                              : {
                                  ...doc,
                                  images: [
                                    ...doc.images,
                                    {
                                      id: crypto.randomUUID(),
                                      assetId: result.assetId,
                                      caption: option.label,
                                      alt: "",
                                      positionId: null,
                                      projectFileId: option.id,
                                      permission: false,
                                    },
                                  ],
                                },
                          );
                        } catch {
                          setError(
                            "Couldn’t add this workspace image. Try again.",
                          );
                        }
                      } else {
                        setReferences((current) => [
                          ...current.filter(
                            (r) =>
                              !(r.kind === option.kind && r.id === option.id),
                          ),
                          option,
                        ]);
                        picker?.insert?.(option);
                      }
                      setPicker(null);
                    }}
                  >
                    {option.label}
                  </button>
                ))
            )}
            {!optionsLoading && !options.length && (
              <p className="nb-compact p-3 text-muted-foreground">
                No available items. Private workspace content stays private.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview && !!active && !!d}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-4xl overflow-auto">
          <DialogTitle>
            {preview === "draft" ? "Preview private draft" : "View as visitor"}
          </DialogTitle>
          <DialogDescription>
            {preview === "draft"
              ? "Only you can see this draft."
              : "This uses the last published contribution and current sharing settings."}
          </DialogDescription>
          {active &&
          d &&
          (preview === "draft" ||
            (active.visibility === "public" &&
              active.presentation?.visible &&
              active.projectVisibility !== "private" &&
              !["draft", "deleted"].includes(active.projectStatus ?? "") &&
              profileVisibility === "public")) ? (
            <ContributionStoryView
              key={preview}
              contribution={active}
              story={
                preview === "draft" ? d : (active.presentation ?? undefined)
              }
              refs={
                preview === "draft" ? references : active.resolvedReferences
              }
              expandedByDefault
            />
          ) : (
            <p className="nb-compact py-8">
              {/* Live-fix 65: say why, and what to do. */}
              This contribution is not shown to public visitors. {active ? hiddenReason(active, profileVisibility) : null}
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirm === "unlisted"
              ? "Share an unlisted workspace on your profile?"
              : "Remove this external contribution?"}
          </DialogTitle>
          <DialogDescription>
            {confirm === "unlisted"
              ? "People who visit your profile will be able to discover this workspace through your contribution."
              : "The contribution will disappear from your profile. You can undo removal."}
          </DialogDescription>
          {confirm === "unlisted" ? (
            <>
              <label className="nb-story-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I want this unlisted workspace listed on my profile.
              </label>
              <Button
                type="button"
                disabled={!consent}
                onClick={() => {
                  if (active)
                    patch(active.id, { visible: true, allowUnlisted: true });
                  setConfirm(null);
                }}
              >
                Allow profile listing
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => void save("delete")}
              disabled={busy}
            >
              Remove contribution
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!conflict}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogTitle>A newer contribution version exists</DialogTitle>
          <DialogDescription>
            Your draft is kept. Review the latest saved story before deciding
            which to use.
          </DialogDescription>
          {conflict && (
            <ContributionStoryView
              contribution={conflict}
              story={storyFromContribution(conflict)}
              expandedByDefault
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (conflict) {
                  const doc = storyFromContribution(conflict);
                  bases.current[conflict.id] = doc;
                  versions.current[conflict.id] = conflict.version ?? 1;
                  setDocuments((current) => ({
                    ...current,
                    [conflict.id]: doc,
                  }));
                }
                setConflict(null);
                setError(null);
                setPauseAutosave(false);
              }}
            >
              Use latest draft
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (conflict) {
                  const latest = storyFromContribution(conflict);
                  const merged = mergeContributionStory(
                    bases.current[conflict.id] ?? latest,
                    docs.current[conflict.id] ?? latest,
                    latest,
                  );
                  bases.current[conflict.id] = latest;
                  versions.current[conflict.id] = conflict.version ?? 1;
                  setDocuments((current) => ({
                    ...current,
                    [conflict.id]: merged,
                  }));
                }
                setConflict(null);
                setError(null);
                setStatus("Review your draft, then Save draft.");
              }}
            >
              Keep my draft, use latest version
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setLinkOpen(false);
            setDuplicateId(null);
            setMergeConsent(false);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-auto">
          <DialogTitle>Link your contribution to a workspace</DialogTitle>
          <DialogDescription>
            Your story stays in a private draft. Existing public content is
            unchanged.
          </DialogDescription>
          <input
            className="nb-story-input"
            aria-label="Search your workspaces"
            placeholder="Search your workspaces…"
            value={linkQuery}
            onChange={(e) => setLinkQuery(e.target.value)}
          />
          <select
            className="nb-story-input"
            aria-label="Workspace to link"
            value={linkTarget}
            onChange={(e) => {
              setLinkTarget(e.target.value);
              setDuplicateId(null);
              setMergeConsent(false);
            }}
          >
            <option value="">Choose a workspace</option>
            {linkOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          {duplicateId && (
            <>
              <p className="nb-compact">
                This workspace already has a contribution. The stories will be
                combined in its private draft. The external entry can be
                restored after removal.
              </p>
              {records.find((r) => r.id === duplicateId) && (
                <ContributionStoryView
                  contribution={records.find((r) => r.id === duplicateId)!}
                  story={documents[duplicateId]}
                  expandedByDefault
                />
              )}
              <label className="nb-story-check">
                <input
                  type="checkbox"
                  checked={mergeConsent}
                  onChange={(e) => setMergeConsent(e.target.checked)}
                />
                I reviewed the existing story and want to merge these
                contributions.
              </label>
            </>
          )}
          <Button
            type="button"
            disabled={!linkTarget || busy || (!!duplicateId && !mergeConsent)}
            onClick={() => void save("link")}
          >
            {duplicateId ? "Merge into private draft" : "Link and keep my story"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
