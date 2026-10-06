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
