// Notifications › Your day (settings mix): 24 hour cells showing quiet hours, a pause and now.

export type DayCell = { quiet: boolean; pause: boolean; now: boolean };

/** `pauseEndHour`: the hour the pause ends today (24 when it runs past midnight), or null when not paused. */
export function dayCells({ quiet, nowHour, pauseEndHour }: { quiet: { enabled: boolean; startMinute: number; endMinute: number }; nowHour: number; pauseEndHour: number | null }): DayCell[] {
  const inQuiet = (minute: number) => {
    if (!quiet.enabled || quiet.startMinute === quiet.endMinute) return false;
    return quiet.startMinute < quiet.endMinute ? minute >= quiet.startMinute && minute < quiet.endMinute : minute >= quiet.startMinute || minute < quiet.endMinute;
  };
  return Array.from({ length: 24 }, (_, hour) => ({
    quiet: inQuiet(hour * 60),
    pause: pauseEndHour !== null && hour >= nowHour && hour < pauseEndHour,
    now: hour === nowHour,
  }));
}
