export const MAX_MOUNTED_PERSON_CARDS = 500;
export const MAX_RETAINED_PERSON_QUERY_PAGES = 10;

export function boundPersonCardItems<T>(items: readonly T[]): readonly T[] {
  return items.length <= MAX_MOUNTED_PERSON_CARDS
    ? items
    : items.slice(items.length - MAX_MOUNTED_PERSON_CARDS);
}
