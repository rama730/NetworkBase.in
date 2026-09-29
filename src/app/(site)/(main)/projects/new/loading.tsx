import { CreateProjectShellSkeleton } from "@/components/projects/create-wizard/CreateProjectShellSkeleton";

/** Shown the moment New project is clicked; matches the full-page wizard exactly. */
export default function NewProjectLoading() {
  return <CreateProjectShellSkeleton />;
}
