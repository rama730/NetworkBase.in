"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Folder,
  ListTodo,
  FileOutput,
  Clock3,
  Star,
  Trash2,
  Github,
  CalendarRange,
  Inbox,
  Building2,
} from "lucide-react";
import type { OrgFilesInfo } from "@/components/organizations/OrgFilesPanel";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useFilesStore } from "@/stores/filesStore";
import { FILES_NAVIGATED_EVENT, useNavigateTo } from "./hooks/useNavigateTo";

export type FilesInspector =
  | "details"
  | "linked_tasks"
  | "version_history"
  | null;
export type FilesViewId =
  | "project"
  | "tasks"
  | "materials"
  | "from_org"
  | "submissions"
  | "deliverables"
  | "github"
  | "recent"
  | "starred"
  | "trash";
export const fileCollectionViews = [
  { id: "project", label: "All files", Icon: Folder },
  { id: "tasks", label: "Task files", Icon: ListTodo },
  { id: "materials", label: "Sprint materials", Icon: CalendarRange },
  { id: "from_org", label: "From the organization", Icon: Building2 },
  { id: "submissions", label: "Final files", Icon: Inbox },
  { id: "deliverables", label: "Final files", Icon: FileOutput },
  { id: "github", label: "Repository sync", Icon: Github },
  { id: "recent", label: "Recent", Icon: Clock3 },
  { id: "starred", label: "Starred", Icon: Star },
  { id: "trash", label: "Trash", Icon: Trash2 },
] as const;

export type FileRoleFilter = "all" | "deliverable" | "reference" | "working";

/**
 * The organization's own views (report §7.8, §18.6): Sprint materials for its people, Submissions for its admins;
 * From the organization and Final files inside one of its workspaces. Nowhere else.
 */
export function orgViewAllowed(view: FilesViewId, org: OrgFilesInfo | null | undefined, canReadTasks: boolean) {
  if (view !== "materials" && view !== "from_org" && view !== "submissions") return true;
  if (!org) return false;
  if (view === "materials") return org.mode === "org" && canReadTasks;
  if (view === "from_org") return org.mode === "child";
  return org.mode === "org" ? org.isAdmin : canReadTasks || org.isAdmin;
}

const FilesViewsContext = createContext<{
  scrollOffsets: React.RefObject<Map<string, number>>;
  view: FilesViewId;
  inspector: FilesInspector;
  setInspector: React.Dispatch<React.SetStateAction<FilesInspector>>;
  taskId: string | null;
  taskTitle: string;
  setTaskTitle: React.Dispatch<React.SetStateAction<string>>;
  fileRole: "all" | "deliverable" | "reference" | "working";
  setFileRole: (role: "all" | "deliverable" | "reference" | "working") => void;
  query: string;
  setQuery: (query: string) => void;
  sidebarMode: "collections" | "tree";
  showTree: () => void;
  showCollections: () => void;
  canReadTasks: boolean;
  canOpenGitHub: boolean;
  /** Orgs rename collections (report §23.3): "Submissions" in Education, "From CSE 3B" in its workspaces. */
  viewLabel: (view: FilesViewId) => string;
  /** The organization this Files tab belongs to, or is inside. */
  org: OrgFilesInfo | null;
  returnToCollection: () => void;
  selectView: (view: FilesViewId) => void;
  selectTask: (id: string | null) => void;
} | null>(null);
export const useFilesViews = () => useContext(FilesViewsContext);

export function FilesViews({
  projectId,
  canReadTasks,
  canOpenGitHub,
  githubAccessResolved,
  viewLabels,
  org = null,
  children,
}: {
  projectId: string;
  canReadTasks: boolean;
  canOpenGitHub: boolean;
  githubAccessResolved: boolean;
  viewLabels?: Partial<Record<FilesViewId, string>>;
  org?: OrgFilesInfo | null;
  children: React.ReactNode;
}) {
  const viewLabel = useCallback(
    (id: FilesViewId) => viewLabels?.[id] ?? fileCollectionViews.find((item) => item.id === id)!.label,
    [viewLabels],
  );
  const scrollOffsets = useRef(new Map<string, number>());
  const { canEdit } = useFilesTabRole();
  const [inspector, setInspector] = useState<FilesInspector>(null);
  const [pendingChange, setPendingChange] = useState<{
    view: FilesViewId;
    taskId: string | null;
    preserveQuery: boolean;
  } | null>(null);
  const [view, setView] = useState<FilesViewId>("project");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskHeading, setTaskHeading] = useState({
    id: null as string | null,
    title: "",
  });
  const taskTitle = taskHeading.id === taskId ? taskHeading.title : "";
  const setTaskTitle = useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (value) => {
      setTaskHeading((current) => ({
        id: taskId,
        title:
          typeof value === "function"
            ? value(current.id === taskId ? current.title : "")
            : value,
      }));
    },
    [taskId],
  );
  const [fileRole, setFileRole] = useState<
    "all" | "deliverable" | "reference" | "working"
  >("all");
  const [query, setQuery] = useState("");
  const [sidebarMode, setSidebarMode] = useState<"collections" | "tree">(
    "collections",
  );
  const navigateTo = useNavigateTo(projectId);
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectId !== projectId || detail.preserveQuery) return;
      if (detail.isFolder) {
        setQuery("");
        const url = new URL(window.location.href);
        url.searchParams.delete("filesQuery");
        window.history.replaceState(window.history.state, "", url);
      }
    };
    window.addEventListener(FILES_NAVIGATED_EVENT, onNavigate);
    return () => window.removeEventListener(FILES_NAVIGATED_EVENT, onNavigate);
  }, [projectId]);
  const restoreView = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("filesView") as FilesViewId;
    if (value === "github" && !githubAccessResolved) return;
    const nextView =
      fileCollectionViews.some((item) => item.id === value) &&
      (canEdit || value !== "trash") &&
      (canReadTasks || !["tasks", "deliverables"].includes(value)) &&
      (value !== "github" || canOpenGitHub) &&
      orgViewAllowed(value, org, canReadTasks)
        ? value
        : "project";
    setView(nextView);
    const nextTask = ["tasks", "deliverables"].includes(nextView)
      ? params.get("filesTask")
      : null;
    setTaskId(nextTask);
    const role = params.get("filesRole");
    setFileRole(
      (nextView === "tasks" &&
        nextTask &&
        (role === "deliverable" || role === "reference" || role === "working")) ||
      (nextView === "deliverables" &&
        nextTask &&
        (role === "deliverable" || role === "reference" || role === "working"))
        ? role
        : nextView === "deliverables"
          ? "deliverable"
          : "all",
    );
    setQuery(params.get("filesQuery") ?? "");
    setSidebarMode(
      params.get("filesNav") === "tree" ||
        (!params.has("filesNav") &&
          !value &&
          (params.has("path") || params.has("fileId")))
        ? "tree"
        : "collections",
    );
    if (value && nextView === "project" && value !== "project") {
      params.delete("filesView");
      params.delete("filesTask");
      const nextUrl = new URL(window.location.href);
      nextUrl.search = params.toString();
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [canReadTasks, canEdit, canOpenGitHub, githubAccessResolved, org]);
  useEffect(() => {
    restoreView();
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, [restoreView]);
  function change(
    nextView: FilesViewId,
    nextTask: string | null,
    preserveQuery = false,
  ) {
    if (useFilesStore.getState().byProjectId[projectId]?.dirtyFileId) {
      setPendingChange({ view: nextView, taskId: nextTask, preserveQuery });
      return;
    }
    setInspector(null);
    navigateTo(null, { preserveQuery: true });
    setView(nextView);
    setTaskId(nextTask);
    if (nextTask !== taskId || nextView !== view) setTaskTitle("");

    setSidebarMode(nextView === "project" ? "tree" : "collections");
    const url = new URL(window.location.href);
    url.searchParams.delete("path");
    url.searchParams.delete("fileId");
    url.searchParams.delete("filesPanel");
    if (nextTask !== taskId || nextView !== view) {
      setFileRole("all");
      url.searchParams.delete("filesRole");
    }
    let nextQuery = preserveQuery ? query : "";
    if (nextView === view && nextTask !== taskId) {
      if (nextTask) {
        url.searchParams.set("filesGroupQuery", query);
        nextQuery = "";
      } else {
        nextQuery = url.searchParams.get("filesGroupQuery") ?? "";
        url.searchParams.delete("filesGroupQuery");
      }
    } else if (nextView !== view) url.searchParams.delete("filesGroupQuery");
    setQuery(nextQuery);
    if (nextQuery) url.searchParams.set("filesQuery", nextQuery);
    else url.searchParams.delete("filesQuery");
    if (nextView === "project") url.searchParams.set("filesNav", "tree");
    else url.searchParams.delete("filesNav");
    if (nextView === "project") url.searchParams.delete("filesView");
    else url.searchParams.set("filesView", nextView);
    if (nextTask) url.searchParams.set("filesTask", nextTask);
    else url.searchParams.delete("filesTask");
    // A view or task filter replaces; folder and file moves keep their history (unified back A2, R5).
    window.history.replaceState(window.history.state, "", url);
  }
  const selectView = (value: FilesViewId) => change(value, null);
  const selectTask = (id: string | null) => change(view, id, true);
  function setNavigation(mode: "collections" | "tree") {
    setSidebarMode(mode);
    const url = new URL(window.location.href);
    url.searchParams.set("filesNav", mode);
    window.history.replaceState(window.history.state, "", url);
  }
  function updateQuery(value: string) {
    setQuery(value);
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("filesQuery", value);
    else url.searchParams.delete("filesQuery");
    window.history.replaceState(window.history.state, "", url);
  }
  const handleSetFileRole = useCallback((role: FileRoleFilter) => {
    setFileRole(role);
    const url = new URL(window.location.href);
    if (role === "all") url.searchParams.delete("filesRole");
    else url.searchParams.set("filesRole", role);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const handleShowTree = useCallback(() => setNavigation("tree"), []);
  const handleShowCollections = useCallback(() => setNavigation("collections"), []);
  const handleReturnToCollection = useCallback(() => change(view, taskId, true), [change, view, taskId]);

  const contextValue = useMemo(
    () => ({
      scrollOffsets,
      view,
      inspector,
      setInspector,
      taskId,
      taskTitle,
      setTaskTitle,
      fileRole,
      setFileRole: handleSetFileRole,
      query,
      setQuery: updateQuery,
      sidebarMode,
      showTree: handleShowTree,
      showCollections: handleShowCollections,
      canReadTasks,
      canOpenGitHub,
      viewLabel,
      org,
      selectView,
      selectTask,
      returnToCollection: handleReturnToCollection,
    }),
    [
      scrollOffsets,
      view,
      inspector,
      setInspector,
      taskId,
      taskTitle,
      setTaskTitle,
      fileRole,
      handleSetFileRole,
      query,
      updateQuery,
      sidebarMode,
      handleShowTree,
      handleShowCollections,
      canReadTasks,
      canOpenGitHub,
      viewLabel,
      org,
      selectView,
      selectTask,
      handleReturnToCollection,
    ]
  );

  return (
    <FilesViewsContext.Provider value={contextValue}>
      <div className="h-full min-h-0 min-w-0">{children}</div>
      <ConfirmDialog
        open={!!pendingChange}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null);
        }}
        title="Discard unsaved changes?"
        description="Your file edits have not been saved. Discard them and change view?"
        confirmLabel="Discard and continue"
        variant="destructive"
        onConfirm={() => {
          if (!pendingChange) return;
          const state = useFilesStore.getState();
          const dirty = state.byProjectId[projectId]?.dirtyFileId;
          if (dirty) state.setDirtyFile(projectId, dirty, false);
          change(
            pendingChange.view,
            pendingChange.taskId,
            pendingChange.preserveQuery,
          );
          setPendingChange(null);
        }}
      />
    </FilesViewsContext.Provider>
  );
}
