/**
 * The task a pull request is for (report F6): "Closes #4" (also fixes, resolves) in its title or body, else a branch
 * named nb/4-… (the CLI's own branch names). Null when neither names one.
 * @param {{ title?: string | null, body?: string | null, head?: { ref?: string } } | null} pr
 */
export function taskFromPullRequest(pr) {
  if (!pr) return null;
  const words = `${pr.title ?? ""}\n${pr.body ?? ""}`;
  const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i.exec(words);
  if (closes) return closes[1];
  const branch = /^nb\/(\d+)(?:-|$)/.exec(pr.head?.ref ?? "");
  return branch ? branch[1] : null;
}
