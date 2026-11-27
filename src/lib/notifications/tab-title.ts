/** "(2) Discover · NetworkBase": the tab title carries the Needs you count (notifications mix), and only that. */
export function titleWithNeedsCount(title: string, count: number): string {
    const bare = title.replace(/^\(\d+\+?\)\s+/, "");
    if (count <= 0) return bare;
    return `(${count > 99 ? "99+" : count}) ${bare}`;
}
