/**
 * Which NetworkBase side a GitHub sync uses (report H6, phase H-5): the repository's default branch is main; any other
 * GitHub branch is the NetworkBase branch of the same name. A pull creates that branch when it's missing; a push to a
 * GitHub branch with no NetworkBase twin sends main (so "push main to a new branch and open a pull request" works).
 * With Branches off, everything is main as before.
 */
export type LocalSide = { kind: "main" } | { kind: "branch"; branchId: string } | { kind: "create" };

export function mapLocalSide(input: {
  branchesOn: boolean;
  direction: "push" | "pull";
  githubBranch: string;
  defaultBranch: string | null;
  newBranch: boolean;
  nbBranch: { id: string; status: string } | null;
}): LocalSide {
  if (!input.branchesOn || input.newBranch || !input.defaultBranch || input.githubBranch === input.defaultBranch) return { kind: "main" };
  if (input.nbBranch?.status === "active") return { kind: "branch", branchId: input.nbBranch.id };
  return input.direction === "pull" ? { kind: "create" } : { kind: "main" };
}
