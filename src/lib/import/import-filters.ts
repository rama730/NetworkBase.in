/**
 * Shared import filters to keep UI preview and importer consistent.
 * Keep this tiny + dependency-free (pure optimization).
 */

// Regenerable tool output: never worth storing, so every upload path drops it.
// Measured 2026-11-05: one uploaded CodeQL database was 55% of all stored bytes.
export const TOOL_OUTPUT_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  '.tox',
  '.nyc_output',
  '.venv',
  'venv',
  'codeql-db',
  'codeql_db',
  '.codeql',
]);

/** Case-insensitive whole-folder match; the file name itself is never tested. */
export function isToolOutputPath(pathLike: string): boolean {
  const parts = (pathLike || '').split(/[\\/]+/g).filter(Boolean).slice(0, -1);
  return parts.some((p) => TOOL_OUTPUT_DIRS.has(p.toLowerCase()));
}

// GitHub import is stricter: it also skips build and editor folders.
export const IGNORED_DIRS = new Set([
  ...TOOL_OUTPUT_DIRS,
  '.github',
  'dist',
  'build',
  'out',
  'vendor',
  '.DS_Store',
  'coverage',
  '.vercel',
  '.netlify',
  '.serverless',
  '.idea',
  '.vscode',
  'tmp',
  'temp',
  'logs'
]);

// Skip large files (> 25MB) to avoid timeouts/memory spikes.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function shouldIgnorePath(pathLike: string): boolean {
  const v = (pathLike || '').trim();
  if (!v) return false;
  // Normalize to forward slashes for GitHub paths; split on both for safety.
  const parts = v.split(/[\\/]+/g).filter(Boolean);
  return parts.some((p) => IGNORED_DIRS.has(p));
}

export function isTooLarge(bytes: number | null | undefined): boolean {
  if (bytes == null) return false;
  return bytes > MAX_FILE_BYTES;
}

