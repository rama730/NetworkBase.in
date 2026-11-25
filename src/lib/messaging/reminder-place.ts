/** Where a reminder's message lives: "#design", a group's name, or "Messages" for a DM (never the partner twice). */
export function reminderPlace(row: { channel_name: string | null; channel_title: string | null; partner: string | null }) {
  if (row.channel_name) return `#${row.channel_name}`;
  return row.channel_title || (row.partner ? "Messages" : null);
}
