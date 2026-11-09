// Assignment flow: a copy's "why it moved" line shows until its person next opens the card. Per viewer and per
// browser on purpose: it's a notice, not a record (the move itself is in the task's activity).
const key = (taskId: string) => `nb:move-seen:${taskId}`;

export function moveSeen(taskId: string, at: string): boolean {
  try { return (window.localStorage.getItem(key(taskId)) ?? "") >= at; } catch { return false; }
}

export function markMoveSeen(taskId: string, at: string) {
  try { window.localStorage.setItem(key(taskId), at); } catch { /* private window: the line just shows again */ }
}
