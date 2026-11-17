// Task 6.4: Files tab text viewer (Raw + thinned CodeMirror Edit).
//
// Validates: Req 5.2, Req 5.8, Req 15.4, Req 15.13.
// See design.md § FileView and § Open Question 6.
//
// Surface contract:
//
//   • Raw mode — Req 5.2: plain text `<pre>`, no toolbars, no syntax
//     highlighting, no line numbers. Renders the last-saved snapshot
//     (`savedContent`), never the dirty buffer, so switching Raw ↔ Edit
//     cannot surface unsaved noise as "the raw bytes".
//
//   • Edit mode — Req 5.8 + Open Question 6: thinned CodeMirror setup.
//     Explicitly no lint plugin (Req 15.4), no cursor-presence / cursor
//     protocol wiring (Req 15.13) or conflict-resolution dialog. FileView
//     acquires the session-scoped editing lease before mounting Edit mode.
//     The editor is loaded via `next/dynamic`
//     so CodeMirror does not ship in the Files-tab initial chunk — this is
//     required for the Req 16 performance budget (no editor code loads
//     until the user actually enters Edit mode).
//
//   • Save — an explicit `<button>Save</button>`. No autosave. The revision
//     modal chooses between an append-only new revision and replacing the
//     active revision. Both choices upload to a fresh object key and use the
//     same transactional server mutation; `upsertNodes` then propagates the
//     new metadata to every files-tab surface. Authorization, optimistic
//     base-version checks, and collaborator locks are enforced server-side.
//
//   • Dirty state — reported through the optional `onDirtyChange` callback
//     so the parent (`FileView`) can thread it into `MetadataStrip` per
//     Open Question 2 ("explicit Save + dirty indicator"). We do not keep
//     a per-tab dirty-buffer store (design § Store Changes / DROPPED
//     `fileStates`); the buffer lives as local state and is lost on
//     unmount, which is intentional — `FileView` is keyed by
//     `currentLocation.id` so switching files remounts this component and
//     discards the stale buffer. That is the same structural guarantee
//     that fixes the Req 17 metadata-stale bug.

"use client";
import { FilesHeaderSlot } from "../FilesHeaderSlot";

import { toast, feedbackError } from "@/lib/feedback";

import * as React from "react";
import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/components/providers/theme-provider";
import type { WorkspaceNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { useFilesStore } from "@/stores/filesStore";
import { saveFileRevision } from "@/hooks/useFileVersions";
import { getWorkspaceFileContent } from "@/app/actions/files/content";
import { listFileVersions } from "@/app/actions/files/versions";
import { isProtectedMain, useMainProtected, useSaveToBranch } from "@/components/workspaces/v2/files-tab/SaveToBranch";
import type { BrowserFileLease, FileLeaseView } from "@/lib/files/file-lease-client";
import type { FileLeaseStatus } from "../hooks/useFileLease";
import { saveBlob } from "@/lib/download";

const RevisionControlModal = dynamic(() => import("@/components/ui/RevisionControlModal").then((mod) => mod.RevisionControlModal), { ssr: false });

// Dynamic import keeps `@uiw/react-codemirror` (and its `@codemirror/*`
// transitive tree) out of the Files-tab initial chunk. The import only
// fires when the user opens View or Edit mode, preserving the
// Req 16.1–16.3 performance budget. `ssr: false` is required because the
// editor touches `window` and `document` during construction.
function parseLineRangeFromHash(hash: string): { fromLine: number; toLine: number } | null {
  if (!hash) return null;
  const match = hash.match(/^#L(\d+)(?:-L(\d+))?$/i);
  if (!match) return null;
  const rawStart = match[1];
  if (!rawStart) return null;
  const start = parseInt(rawStart, 10);
  const rawEnd = match[2];
  const end = rawEnd ? parseInt(rawEnd, 10) : start;
  if (isNaN(start) || start < 1) return null;
  return {
    fromLine: Math.min(start, end),
    toLine: Math.max(start, end),
  };
}

// Dynamic import keeps `@uiw/react-codemirror` (and its `@codemirror/*`
// transitive tree) out of the Files-tab initial chunk. The import only
// fires when the user opens View or Edit mode, preserving the
// Req 16.1–16.3 performance budget. `ssr: false` is required because the
// editor touches `window` and `document` during construction.
export const CodeMirrorEditor = dynamic(
  async () => {
    const [
      { default: CodeMirror },
      { Decoration, EditorView, lineNumbers },
      { StateEffect, StateField },
    ] = await Promise.all([
      import("@uiw/react-codemirror"),
      import("@codemirror/view"),
      import("@codemirror/state"),
    ]);

    const selectedText = Decoration.mark({ class: "nb-selected-text" });
    const selectionForeground = EditorView.decorations.compute(["doc", "selection"], (state) =>
      Decoration.set(
        state.selection.ranges
          .filter((range) => !range.empty)
          .map((range) => selectedText.range(range.from, range.to)),
        true,
      ),
    );

    const setLineRangeEffect = StateEffect.define<{ fromLine: number; toLine: number } | null>();
    const lineRangeField = StateField.define({
      create() {
        return Decoration.none;
      },
      update(decorations, tr) {
        for (const effect of tr.effects) {
          if (effect.is(setLineRangeEffect)) {
            if (!effect.value) return Decoration.none;
            const { fromLine, toLine } = effect.value;
            const start = Math.min(fromLine, toLine);
            const end = Math.max(fromLine, toLine);
            const decos = [];
            for (let l = start; l <= end; l++) {
              if (l >= 1 && l <= tr.newDoc.lines) {
                const line = tr.newDoc.line(l);
                decos.push(Decoration.line({ class: "cm-highlighted-line-range" }).range(line.from));
              }
            }
            return Decoration.set(decos, true);
          }
        }
        return decorations.map(tr.changes);
      },
      provide: (f) => EditorView.decorations.from(f),
    });

    return function SelectionStyledEditor({
      extensions,
      selectedLineRange,
      scrollTargetLine,
      onLineGutterClick,
      editorViewRef,
      ...props
    }: React.ComponentProps<typeof CodeMirror> & {
      selectedLineRange?: { fromLine: number; toLine: number } | null;
      scrollTargetLine?: number | null;
      onLineGutterClick?: (lineNo: number, shiftKey: boolean) => void;
      editorViewRef?: React.MutableRefObject<any>;
    }) {
      const lineGutterHandlerRef = React.useRef(onLineGutterClick);
      lineGutterHandlerRef.current = onLineGutterClick;

      const customLineNumbers = React.useMemo(
        () =>
          lineNumbers({
            domEventHandlers: {
              mousedown: (view, line, event) => {
                const mouseEvent = event as MouseEvent;
                if (mouseEvent.button !== 0) return false;
                const lineNo = view.state.doc.lineAt(line.from).number;
                lineGutterHandlerRef.current?.(lineNo, mouseEvent.shiftKey);
                return true;
              },
            },
          }),
        [],
      );

      const editorExtensions = React.useMemo(
        () => [
          selectionForeground,
          lineRangeField,
          customLineNumbers,
          ...(extensions ?? []),
        ],
        [extensions, customLineNumbers],
      );

      const { onCreateEditor } = props;
      const handleCreateEditor = React.useCallback(
        (view: any, state: any) => {
          if (editorViewRef) editorViewRef.current = view;
          onCreateEditor?.(view, state);
          if (selectedLineRange && selectedLineRange.fromLine <= view.state.doc.lines) {
            const line = view.state.doc.line(selectedLineRange.fromLine);
            view.dispatch({
              effects: [
                setLineRangeEffect.of(selectedLineRange),
                EditorView.scrollIntoView(line.from, { y: "center" }),
              ],
            });
          }
        },
        [editorViewRef, onCreateEditor, selectedLineRange],
      );

      React.useEffect(() => {
        if (!editorViewRef?.current) return;
        const view = editorViewRef.current;
        const effects: any[] = [setLineRangeEffect.of(selectedLineRange ?? null)];
        if (scrollTargetLine && scrollTargetLine <= view.state.doc.lines) {
          const line = view.state.doc.line(scrollTargetLine);
          effects.push(EditorView.scrollIntoView(line.from, { y: "center" }));
        }
        view.dispatch({ effects });
      }, [selectedLineRange, scrollTargetLine, editorViewRef]);

      return (
        <CodeMirror
          {...props}
          onCreateEditor={handleCreateEditor}
          extensions={editorExtensions}
        />
      );
    };
  },
  {
    ssr: false,
    loading: () => <EditorLoading />,
  },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextViewerMode = "view" | "raw" | "edit";

export interface TextViewerProps {
  projectId: string;
  node: WorkspaceNode;
  canEdit: boolean;
  /**
   * Active mode. Controlled by the parent `FileView` (wired to the
   * `Raw` / `Edit` buttons in `FileActionsBar`).
   */
  mode: TextViewerMode;
  /**
   * Fired once a Save round-trip completes successfully. The parent can
   * use this to clear a dirty badge, show a toast, or record a recent.
   */
  onSaved?: () => void;
  /**
   * Fired whenever the dirty state of the Edit buffer changes. The parent
   * (via `FileView`) threads this into `MetadataStrip` for the dirty
   * indicator required by Open Question 2.
   */
  onDirtyChange?: (dirty: boolean) => void;
  lease?: BrowserFileLease | null;
  leaseStatus?: FileLeaseStatus;
  leaseConflict?: FileLeaseView | null;
  onCancel?: () => void;
  onRetryLease?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TextViewer({
  projectId,
  node,
  canEdit,
  mode,
  onSaved,
  onDirtyChange,
  lease = null,
  leaseStatus = "idle",
  leaseConflict = null,
  onCancel,
  onRetryLease,
}: TextViewerProps): React.JSX.Element {
  const { resolvedTheme } = useTheme();
  const upsertNodes = useFilesStore((s) => s.upsertNodes);

  type LoadStatus = "loading" | "ready" | "error";
  const [status, setStatus] = React.useState<LoadStatus>("loading");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  // `savedContent` is the canonical server-side text; `content` is the live
  // buffer. They diverge only in Edit mode after a user keystroke, and
  // re-converge after a successful Save.
  const [savedContent, setSavedContent] = React.useState<string>("");
  const [content, setContent] = React.useState<string>("");
  const [baseVersion, setBaseVersion] = React.useState(node.currentVersion ?? 1);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const editSnapshot = React.useRef<{ nodeId: string; version: number; updatedAt: WorkspaceNode["updatedAt"] } | null>(null);
  if (mode !== "edit") editSnapshot.current = null;
  else if (editSnapshot.current?.nodeId !== node.id) editSnapshot.current = { nodeId: node.id, version: node.currentVersion ?? 1, updatedAt: node.updatedAt };
  // Freeze the base while editing: realtime revisions must not replace the draft.
  const loadVersion = editSnapshot.current?.version ?? node.currentVersion ?? 1;
  const loadUpdatedAt = editSnapshot.current?.updatedAt ?? node.updatedAt;
  const [baseHash, setBaseHash] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  // ── GitHub Line Range Selection & Deep Link Sync (#L10 / #L10-L25) ──
  const [selectedRange, setSelectedRange] = React.useState<{ fromLine: number; toLine: number } | null>(() => {
    if (typeof window !== "undefined") {
      return parseLineRangeFromHash(window.location.hash);
    }
    return null;
  });
  const [scrollTargetLine, setScrollTargetLine] = React.useState<number | null>(() => {
    if (typeof window !== "undefined") {
      return parseLineRangeFromHash(window.location.hash)?.fromLine ?? null;
    }
    return null;
  });
  const anchorLineRef = React.useRef<number | null>(selectedRange?.fromLine ?? null);
  const editorViewRef = React.useRef<any>(null);

  React.useEffect(() => {
    const handleHashChange = () => {
      const range = parseLineRangeFromHash(window.location.hash);
      setSelectedRange(range);
      anchorLineRef.current = range?.fromLine ?? null;
      if (range) {
        setScrollTargetLine(range.fromLine);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, []);

  const handleLineGutterClick = React.useCallback(
    (lineNo: number, shiftKey: boolean) => {
      // Manual gutter click selects lines without forcing a jumpy scrollIntoView
      setScrollTargetLine(null);
      if (shiftKey && anchorLineRef.current !== null) {
        const from = Math.min(anchorLineRef.current, lineNo);
        const to = Math.max(anchorLineRef.current, lineNo);
        const nextRange = { fromLine: from, toLine: to };
        setSelectedRange(nextRange);
        const hash = from === to ? `#L${from}` : `#L${from}-L${to}`;
        const url = new URL(window.location.href);
        url.hash = hash;
        window.history.replaceState(window.history.state, "", url.toString());
      } else {
        if (selectedRange && selectedRange.fromLine === lineNo && selectedRange.toLine === lineNo) {
          setSelectedRange(null);
          anchorLineRef.current = null;
          const url = new URL(window.location.href);
          url.hash = "";
          window.history.replaceState(window.history.state, "", url.pathname + url.search);
        } else {
          anchorLineRef.current = lineNo;
          const nextRange = { fromLine: lineNo, toLine: lineNo };
          setSelectedRange(nextRange);
          const url = new URL(window.location.href);
          url.hash = `#L${lineNo}`;
          window.history.replaceState(window.history.state, "", url.toString());
        }
      }
    },
    [selectedRange],
  );

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedRange) {
        setSelectedRange(null);
        anchorLineRef.current = null;
        const url = new URL(window.location.href);
        url.hash = "";
        window.history.replaceState(window.history.state, "", url.pathname + url.search);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRange]);

  // ── Editor theme from the app's tokens (CLI report A9.3) ──────────────
  // Loaded with the editor; light and dark come from the same CSS variables.
  const [appTheme, setAppTheme] = React.useState<import("@codemirror/state").Extension | null>(null);

  React.useEffect(() => {
    if (mode !== "edit" && mode !== "view") return;
    let cancelled = false;
    void import("@/lib/editor/codemirror-theme").then((mod) => {
      if (!cancelled) setAppTheme(mod.appEditorTheme(resolvedTheme === "dark"));
    });
    return () => {
      cancelled = true;
    };
  }, [mode, resolvedTheme]);

  // ── Fetch-on-demand ────────────────────────────────────────────────
  // Per task: no per-tab dirty-buffer store. We fetch the content every
  // time this component mounts or the backing node id changes. Because
  // the parent `FileView` is keyed by `currentLocation.id`, a file switch
  // produces a fresh mount and a fresh fetch — no shared cache to go stale.
  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setLoadError(null);
    setContent("");
    setSavedContent("");
    setBaseHash(null);
    setBaseVersion(loadVersion);

    void (async () => {
      try {
        const [text, versions] = await Promise.all([
          getWorkspaceFileContent(projectId, node.id),
          mode === "edit" ? listFileVersions(projectId, node.id, 1) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setSavedContent(text);
        setContent(text);
        setBaseHash(
          versions.find((version) => version.version === loadVersion)?.contentHash ?? null,
        );
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Couldn’t load file content";
        setLoadError(message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, node.id, mode, loadVersion, loadUpdatedAt, loadAttempt]);

  // ── Dirty state ────────────────────────────────────────────────────
  // Only meaningful in Edit mode; Raw always renders `savedContent`, so
  // it can never be dirty. Report changes to the parent for the metadata
  // strip's indicator.
  const isDirty = mode === "edit" && content !== savedContent;
  React.useEffect(() => {
    const discard = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId === projectId && detail.nodeId === node.id) setContent(savedContent);
    };
    window.addEventListener("project:discard-file-edits", discard);
    return () => window.removeEventListener("project:discard-file-edits", discard);
  }, [projectId, node.id, savedContent]);
  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  React.useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  // When leaving Edit mode, discard the in-memory buffer back to the last
  // saved snapshot. Users must save to persist — this matches the explicit
  // Save semantics from Open Question 2 and prevents Raw from displaying
  // unsaved edits.
  React.useEffect(() => {
    if (mode === "raw") {
      setContent(savedContent);
    }
  }, [mode, savedContent]);

  const { offer: offerBranch, dialog: branchDialog } = useSaveToBranch(projectId);
  const mainProtected = useMainProtected(projectId);

  // ── Save ───────────────────────────────────────────────────────────
  const handleSaveClick = React.useCallback(() => {
    if (!canEdit) return;
    if (!lease) {
      toast.error("Editing access expired");
      return;
    }
    if (isSaving) return;
    if (!isDirty) return;
    if (!node.s3Key) {
      toast.error("This file can’t be saved. Reopen it.");
      return;
    }
    setIsModalOpen(true);
  }, [canEdit, isSaving, isDirty, node.s3Key, lease]);

  const handleRevisionOptionSelected = React.useCallback(
    async (choice: { option: "commit"; comment?: string }) => {
      if (!canEdit || isSaving) return;
      // A protected main takes merge requests only (H5): the edit goes on a new branch instead, with one click.
      if (mainProtected && !node.taskId) {
        // Once it's on the branch, main's editor drops the edit (main never had it), so leaving the page doesn't warn.
        offerBranch({ title: choice.comment?.trim() || `Changed ${node.name}`, what: `edit-${node.name}`, change: { kind: "text", path: node.path, text: content, baseHash }, onDone: () => setContent(savedContent) });
        return;
      }
      setIsSaving(true);
      setSaveError(null);

      try {
        const file = new File([content], node.name, {
          type: node.mimeType || "text/plain",
        });
        const result = await saveFileRevision({
          projectId,
          nodeId: node.id,
          file,
          mode: "new_revision",
          comment: choice.comment || "Edited in NetworkBase",
          baseVersion,
          baseHash,
          lease,
        });

        if (result.success) {
          setSavedContent(content);
          setBaseHash(result.version.contentHash ?? null);
          setBaseVersion(result.version.version);
          window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
          upsertNodes(projectId, [result.node]);
          onSaved?.();
          toast.success(`Saved as v${result.version.version}`);
        } else if (isProtectedMain(result.error) && !node.taskId) {
          // A protected main takes merge requests only (H5): offer this edit on a new branch instead.
          offerBranch({ title: `Changed ${node.name}`, what: `edit-${node.name}`, change: { kind: "text", path: node.path, text: content, baseHash }, onDone: () => setContent(savedContent) });
        } else {
          setSaveError(result.error || "Couldn’t save version");
          toast.error(feedbackError(result.error || "Couldn’t save version", "Couldn’t save version"));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setSaveError(message);
        toast.error('Couldn’t save the file');
      } finally {
        setIsSaving(false);
      }
    },
    [baseHash, baseVersion, canEdit, content, isSaving, lease, node.id, node.name, node.mimeType, node.path, node.s3Key, node.taskId, mainProtected, offerBranch, onSaved, projectId, savedContent, upsertNodes]
  );

  // ── Render ─────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading file content"
        data-testid="files-tab-text-viewer-loading"
        className="flex h-full min-h-0 w-full flex-col gap-2 p-6"
      >
        <Skeleton className="h-4 w-48 rounded-[3px]" />
        <Skeleton className="h-4 w-3/4 rounded-[3px]" />
        <Skeleton className="h-4 w-5/6 rounded-[3px]" />
        <Skeleton className="h-4 w-2/3 rounded-[3px]" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        data-testid="files-tab-text-viewer-error"
        className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground"
      >
        <p className="font-medium text-foreground">Couldn’t load file content</p>
        <Button variant="outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry preview</Button>
        {loadError ? (
          <p className="max-w-md break-words text-muted-foreground">
            {loadError}
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === "raw") {
    // Req 5.2: plain text, no toolbars, no syntax highlighting, no line
    // numbers. A bare `<pre>` is the entire surface — nothing else.
    return (
      <pre
        data-testid="files-tab-text-viewer-raw"
        className={cn(
          "h-full min-h-0 w-full overflow-auto whitespace-pre-wrap break-words",
          "bg-background p-4 font-mono text-[13px] leading-[1.55] text-foreground pointer-coarse:text-[14px]",
        )}
      >
        {savedContent}
      </pre>
    );
  }

  if (mode === "view") {
    return (
      <div
        data-testid="files-tab-text-viewer-view"
        className="flex h-full min-h-0 w-full flex-col bg-background"
      >
        <div className="min-h-0 flex-1">
          <CodeMirrorEditor
            value={content}
            editable={false}
            readOnly={true}
            theme={appTheme ?? (resolvedTheme === "dark" ? "dark" : "light")}
            height="100%"
            width="100%"
            className="h-full font-mono text-[13px] leading-[1.55] pointer-coarse:text-[14px]"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
              highlightSelectionMatches: false,
              searchKeymap: false,
              lintKeymap: false,
              foldKeymap: false,
              completionKeymap: false,
              closeBracketsKeymap: false,
            }}
            selectedLineRange={selectedRange}
            scrollTargetLine={scrollTargetLine}
            onLineGutterClick={handleLineGutterClick}
            editorViewRef={editorViewRef}
          />
        </div>
      </div>
    );
  }

  // Edit mode: thinned CodeMirror. No lint (Req 15.4), no cursor-presence
  // (Req 15.13), and no merge dialog. The parent already owns the exclusive
  // editing lease; losing it makes this editor read-only without dropping the
  // dirty buffer. The explicit Save button is the only persistence channel.
  return (
    <div
      data-testid="files-tab-text-viewer-edit"
      className="flex h-full min-h-0 w-full flex-col"
    >
      <FilesHeaderSlot slot="status"><div className="flex items-center gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {!lease ? (
            <span
              data-testid="files-tab-text-viewer-no-lease"
              className="rounded-[3px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground"
              title="Editing lease is not held"
            >
              Read-only
            </span>
          ) : isDirty ? (
            <span
              data-testid="files-tab-text-viewer-dirty"
              className="max-w-16 truncate rounded-[3px] border border-[#F6E7C2] bg-[#FBF4E2] px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[#9A6B00] sm:max-w-none dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-300"
              title="Unsaved changes"
            >
              Unsaved changes
            </span>
          ) : (
            <span
              data-testid="files-tab-text-viewer-clean"
              className="rounded-[3px] border border-[#DBD5C8] bg-[#F3F0EA] px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-[#4C5A61] dark:border-white/10 dark:bg-white/5 dark:text-white/70"
            >
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSaving}
              data-testid="files-tab-text-viewer-cancel"
              className="nb-touch-target h-[28px] rounded-[5px] border-[#DBD5C8] px-2.5 text-xs font-medium hover:bg-[#F3F0EA] dark:border-white/10 dark:hover:bg-white/5"
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSaveClick}
            disabled={!canEdit || !isDirty || isSaving}
            data-testid="files-tab-text-viewer-save"
            className="nb-touch-target h-[28px] rounded-[5px] bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div></FilesHeaderSlot>
      {saveError && <div role="alert" className="border-b border-red-200 p-3 text-xs text-red-700 dark:border-red-900 dark:text-red-300">
        <p>{saveError} Your draft is still here.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => {
          saveBlob(new Blob([content], { type: node.mimeType || "text/plain" }), node.name);
        }}>Download draft</Button>
      </div>}
      {leaseStatus === "lost" || leaseStatus === "conflict" ? (
        <div
          role="alert"
          data-testid="files-tab-text-viewer-lease-lost"
          className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {leaseConflict
            ? `${leaseConflict.lockedByName || "Another member"} is editing this file${leaseConflict.clientKind === "vscode" ? " in VS Code" : ""}.`
            : "The editing lease was lost. Your unsaved buffer is preserved, but saving is blocked until editing access is restored."}
          {onRetryLease && <Button variant="outline" size="sm" className="ml-2" onClick={onRetryLease}>Try editing again</Button>}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <CodeMirrorEditor
          value={content}
          onChange={(next) => setContent(next)}
          editable={canEdit}
          readOnly={!canEdit}
          theme={appTheme ?? (resolvedTheme === "dark" ? "dark" : "light")}
          height="100%"
          width="100%"
          className="h-full font-mono text-[13px] leading-[1.55] pointer-coarse:text-[14px]"
          // Thinned basicSetup. No language extensions, no search keymap,
          // no lint keymap, no completion — the Edit surface is a plain
          // text editor, not an IDE.
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            bracketMatching: true,
            closeBrackets: false,
            autocompletion: false,
            highlightSelectionMatches: false,
            searchKeymap: false,
            lintKeymap: false,
            foldKeymap: false,
            completionKeymap: false,
            closeBracketsKeymap: false,
          }}
          selectedLineRange={selectedRange}
          scrollTargetLine={scrollTargetLine}
          onLineGutterClick={handleLineGutterClick}
          editorViewRef={editorViewRef}
        />
      </div>

      {branchDialog}
      {isModalOpen && (
        <RevisionControlModal
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          fileName={node.name}
          onSelectOption={handleRevisionOptionSelected}
        />
      )}
    </div>
  );
}

function EditorLoading(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center text-xs text-muted-foreground">
      Loading editor…
    </div>
  );
}

export default TextViewer;
