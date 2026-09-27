import path from "node:path";

function buildPathError(label: string, value: string): Error {
  return new Error(`Unsafe ${label}: ${value}`);
}

export function normalizeSafePathSegment(segment: string, label = "path segment"): string {
  const value = (segment ?? "").trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw buildPathError(label, value);
  }
  return value;
}

export function normalizeSafeRelativePath(input: string, label = "path"): string {
  const raw = (input ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw buildPathError(label, raw);
  }

  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw buildPathError(label, raw);
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw buildPathError(label, raw);
    }
  }

  return parts.join("/");
}

export function appendSafePathSegment(parentDir: string, segment: string, label = "path segment"): string {
  const safeSegment = normalizeSafePathSegment(segment, label);
  const normalizedParent = parentDir.endsWith(path.sep)
    ? parentDir.slice(0, -path.sep.length)
    : parentDir;
  return `${normalizedParent}${path.sep}${safeSegment}`;
}

