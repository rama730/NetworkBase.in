import { CreateWorkspaceShellSkeleton } from "@/components/workspaces/create-wizard/CreateWorkspaceShellSkeleton";

/** Shown the moment New project is clicked; matches the full-page wizard exactly. */
export default function NewWorkspaceLoading() {
  return <CreateWorkspaceShellSkeleton />;
}
