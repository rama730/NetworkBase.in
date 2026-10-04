export function formatCalendarDate(dateValue: string | Date): string {
  return new Date(dateValue).toLocaleDateString();
}

export function formatDateTime(dateValue: string | Date): string {
  return new Date(dateValue).toLocaleString();
}
