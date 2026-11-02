// Role words (report §39.5, decision 110): plurals and counts from the organization's own role names, one way.

const UNCOUNTABLE = /^(?:staff|faculty|crew|team)$/i;

/** "Student" → "Students"; already plural or uncountable words stay as they are. */
export function rolePlural(word: string) {
  const w = word.trim();
  return /s$/i.test(w) || UNCOUNTABLE.test(w) ? w : `${w}s`;
}

/** Always a number with the word: "40 Students", "1 Student", "0 TAs". */
export function roleCount(n: number, word: string) {
  return `${n} ${n === 1 ? word.trim() : rolePlural(word)}`;
}
