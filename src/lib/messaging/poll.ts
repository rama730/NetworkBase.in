// /poll messages: the options are numbered lines (or 👍 👎 🤷 for a yes/no question).
// Their vote chips come from the body, so everyone sees every option from the start
// and every chip is a real vote (nobody's reaction is spent seeding them).
export const POLL_NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
export const POLL_DEFAULT = ["👍", "👎", "🤷"];
const HEADER = "📊 **Poll: ";

/** "/poll Question | A | B" → the message body, or null without a question. */
export function pollBody(command: string) {
  const raw = command.replace(/^\/poll\s*/i, "").trim();
  if (!raw) return null;
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const options = parts.slice(1, POLL_NUMBERS.length + 1);
    return `${HEADER}${parts[0]}**\n\n${options.map((opt, i) => `${POLL_NUMBERS[i]} ${opt}`).join("\n")}\n\n*Vote by clicking a number below.*`;
  }
  return `${HEADER}${raw}**\n\n👍 Yes\n👎 No\n🤷 Maybe\n\n*Vote by clicking below.*`;
}

/** The vote emojis of a poll message, in order; [] for any other message. */
export function pollOptions(body: string) {
  if (!body.startsWith(HEADER)) return [];
  const choices = [...POLL_NUMBERS, ...POLL_DEFAULT];
  return body.split("\n").map((line) => choices.find((emoji) => line.startsWith(`${emoji} `))).filter((emoji): emoji is string => Boolean(emoji));
}

/** The poll's question and options with their labels, for the poll card; null for any other message. */
export function pollParts(body: string): { question: string; options: { emoji: string; label: string }[] } | null {
  if (!body.startsWith(HEADER)) return null;
  const question = body.slice(HEADER.length, body.indexOf("**", HEADER.length));
  const choices = [...POLL_NUMBERS, ...POLL_DEFAULT];
  const options = body.split("\n").flatMap((line) => {
    const emoji = choices.find((e) => line.startsWith(`${e} `));
    return emoji ? [{ emoji, label: line.slice(emoji.length + 1).trim() }] : [];
  });
  return { question, options };
}

/**
 * Votes per option (each option is a reaction, so several picks work: "Pick any"). With voters known (poll reactions
 * carry `user_ids`), "people" is everyone who voted and each share is votes ÷ people (the board: 75 % of people picked
 * A); without them, a share is its part of all votes and people is null.
 */
export function pollStats(options: { emoji: string; label: string }[], reactions: { emoji: string; count: number; me: boolean; user_ids?: string[] }[]) {
  const rows = options.map((option) => {
    const r = reactions.find((x) => x.emoji === option.emoji);
    return { ...option, count: r?.count ?? 0, me: r?.me ?? false, voters: r?.user_ids ?? [] };
  });
  const votes = rows.reduce((sum, r) => sum + r.count, 0);
  const known = reactions.some((r) => Array.isArray(r.user_ids));
  const people = known ? new Set(rows.flatMap((r) => r.voters)).size : null;
  const base = people || votes;
  return { votes, people, options: rows.map((r) => ({ ...r, share: base ? Math.min(100, Math.round((r.count / base) * 100)) : 0 })) };
}
