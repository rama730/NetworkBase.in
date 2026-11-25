/** Photos view: files grouped by the month they were shared, newest month first (the list is already newest first). */
export function groupByMonth<T extends { created_at: string }>(files: T[], locale?: string, timeZone?: string) {
  const format = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone });
  const groups: { label: string; files: T[] }[] = [];
  for (const file of files) {
    const label = format.format(new Date(file.created_at));
    const last = groups.at(-1);
    if (last?.label === label) last.files.push(file);
    else groups.push({ label, files: [file] });
  }
  return groups;
}
