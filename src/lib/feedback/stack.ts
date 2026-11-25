/** Ten squares for the Undo clock, lit from the left; the rightmost goes out first. */
export function countdownCells(remaining: number, duration: number): boolean[] {
  const lit = Math.min(10, Math.max(0, Math.ceil((remaining / Math.max(1, duration)) * 10)));
  return Array.from({ length: 10 }, (_, i) => i < lit);
}

/** "7 S", or "PAUSED · 7 S" while the clocks are held. */
export function undoLabel(remaining: number, paused: boolean) {
  return `${paused ? 'PAUSED · ' : ''}${Math.ceil(remaining / 1000)} S`;
}

/** The row under the stack: "+2 more · 1 issue", or "+2 more" when nothing waiting is a problem. */
export function overflowLabel(waiting: number, issues: number) {
  return `+${waiting} more${issues ? ` · ${issues} issue${issues === 1 ? '' : 's'}` : ''}`;
}

export function overflowName(waiting: number) {
  return `${waiting} more waiting, open Pending feedback`;
}
