export type FilePermissionFilter = "all" | "enabled" | "disabled";
export type FilePermissionOptions = {
  cursor?: string | null;
  query?: string;
  permissionFilter?: FilePermissionFilter;
  limit?: number;
};
export type FilePermissionCursor = { rank: number; name: string; id: string };

export function parseFilePermissionCursor(
  cursor?: string | null,
): FilePermissionCursor | null {
  if (!cursor || cursor.length > 2048) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isInteger(value.rank) &&
      value.rank >= 0 &&
      value.rank <= 3 &&
      typeof value.name === "string" &&
      value.name.length <= 512 &&
      typeof value.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.id,
      )
      ? value
      : null;
  } catch {
    return null;
  }
}
export function encodeFilePermissionCursor(
  cursor: FilePermissionCursor,
): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function normalizeFilePermissionOptions(
  options: FilePermissionOptions = {},
) {
  return {
    cursor: parseFilePermissionCursor(options.cursor),
    query: (typeof options.query === "string" ? options.query : "")
      .trim()
      .slice(0, 160),
    permissionFilter:
      options.permissionFilter === "enabled" ||
      options.permissionFilter === "disabled"
        ? options.permissionFilter
        : "all",
    limit: Number.isFinite(options.limit)
      ? Math.min(100, Math.max(1, Math.trunc(options.limit!)))
      : 100,
  };
}
