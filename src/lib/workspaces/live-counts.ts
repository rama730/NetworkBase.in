export type WorkspaceCounts = { viewCount?: number; followersCount?: number };

type CardRow = { id: string; viewCount?: number | null; followersCount?: number | null };
type Pages<T> = { pages: Array<{ projects: T[] }> };

/** One workspace's counts in cached feed pages. Views only ever go up; an unchanged cache keeps its identity, so nothing redraws. */
export function patchCountsInPages<T extends CardRow, D extends Pages<T>>(data: D | undefined, workspaceId: string, counts: WorkspaceCounts): D | undefined {
  if (!data?.pages) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    if (!Array.isArray(page?.projects)) return page;
    const projects = page.projects.map((project) => {
      if (project.id !== workspaceId) return project;
      const viewCount = counts.viewCount === undefined ? project.viewCount : Math.max(project.viewCount ?? 0, counts.viewCount);
      const followersCount = counts.followersCount ?? project.followersCount;
      if (viewCount === project.viewCount && followersCount === project.followersCount) return project;
      changed = true;
      return { ...project, viewCount, followersCount };
    });
    return { ...page, projects };
  });
  return changed ? { ...data, pages } : data;
}
