// Emoji search and :shortcode: for the picker and the composer (round 3 #259).
// ponytail: a curated list of the emoji people use in work chat, with Slack-style names.
// ceiling: rarer emoji aren't searchable here (the OS picker, ⌃⌘Space, still inserts any).
// upgrade: a full Unicode dataset if people ask for emoji that aren't here.
// [emoji, shortcode, ...other words it's found by]
const LIST: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ["👍", "thumbsup", "+1", "yes", "like", "ok"], ["👎", "thumbsdown", "-1", "no", "dislike"],
  ["❤️", "heart", "love"], ["😂", "joy", "laugh", "lol"], ["😄", "smile", "happy"], ["😊", "blush", "happy"],
  ["🙂", "slightly_smiling_face", "smile"], ["😉", "wink"], ["😍", "heart_eyes", "love"], ["🥰", "smiling_face_with_hearts", "love"],
  ["😎", "sunglasses", "cool"], ["🤔", "thinking_face", "hmm", "think"], ["🤨", "raised_eyebrow", "skeptical"],
  ["😐", "neutral_face", "meh"], ["😅", "sweat_smile", "phew"], ["😬", "grimacing", "awkward"], ["🙃", "upside_down_face"],
  ["😢", "cry", "sad"], ["😭", "sob", "crying"], ["😡", "rage", "angry"], ["😱", "scream", "shock"], ["😴", "sleeping", "tired"],
  ["🤯", "exploding_head", "mind_blown"], ["🥳", "partying_face", "party", "celebrate"], ["🤩", "star_struck", "wow"],
  ["😇", "innocent", "angel"], ["🤗", "hugging_face", "hug"], ["🤝", "handshake", "deal", "agree"], ["🙏", "pray", "thanks", "please"],
  ["👏", "clap", "applause", "bravo"], ["🙌", "raised_hands", "hooray", "yay"], ["👋", "wave", "hello", "hi", "bye"],
  ["✋", "hand", "stop", "raised_hand"], ["👌", "ok_hand", "perfect"], ["✌️", "v", "peace", "victory"], ["🤞", "crossed_fingers", "luck"],
  ["💪", "muscle", "strong", "flex"], ["👀", "eyes", "look", "watching"], ["🧠", "brain", "smart"], ["👉", "point_right"],
  ["👈", "point_left"], ["👆", "point_up"], ["👇", "point_down"], ["☝️", "point_up_2"], ["🫡", "saluting_face", "salute", "on_it"],
  ["🔥", "fire", "lit", "hot"], ["✨", "sparkles", "new", "shiny"], ["⭐", "star", "favorite"], ["🌟", "star2", "glowing_star"],
  ["⚡", "zap", "fast", "lightning"], ["💯", "100", "hundred", "perfect"], ["🎉", "tada", "party", "celebrate", "congrats"],
  ["🎊", "confetti_ball", "celebrate"], ["🎈", "balloon", "party"], ["🎁", "gift", "present"], ["🏆", "trophy", "win", "award"],
  ["🥇", "first_place_medal", "gold"], ["🚀", "rocket", "launch", "ship"], ["🛠️", "hammer_and_wrench", "tools", "fix"],
  ["🔧", "wrench", "fix"], ["🐛", "bug", "issue"], ["✅", "white_check_mark", "done", "yes", "check"], ["☑️", "ballot_box_with_check", "done"],
  ["✔️", "heavy_check_mark", "check"], ["❌", "x", "no", "wrong", "cancel"], ["❗", "exclamation", "important"], ["❓", "question", "ask"],
  ["⚠️", "warning", "caution"], ["🚫", "no_entry_sign", "blocked"], ["⛔", "no_entry", "stop"], ["🛑", "octagonal_sign", "stop"],
  ["🔴", "red_circle"], ["🟠", "large_orange_circle"], ["🟡", "large_yellow_circle"], ["🟢", "large_green_circle"], ["🔵", "large_blue_circle"],
  ["⏳", "hourglass_flowing_sand", "waiting", "pending"], ["⏰", "alarm_clock", "time", "reminder"], ["📅", "date", "calendar", "meeting"],
  ["🗓️", "spiral_calendar_pad", "calendar"], ["📌", "pushpin", "pin"], ["📍", "round_pushpin", "location"], ["🔗", "link"],
  ["📎", "paperclip", "attachment"], ["📝", "memo", "note", "write"], ["✏️", "pencil2", "edit"], ["📄", "page_facing_up", "doc"],
  ["📁", "file_folder", "folder"], ["📊", "bar_chart", "chart", "stats"], ["📈", "chart_with_upwards_trend", "up", "growth"],
  ["📉", "chart_with_downwards_trend", "down"], ["💡", "bulb", "idea"], ["🔍", "mag", "search", "find"], ["🔒", "lock", "private"],
  ["🔑", "key"], ["📣", "mega", "announcement"], ["📢", "loudspeaker", "announcement"], ["🔔", "bell", "notification"],
  ["🔕", "no_bell", "mute"], ["💬", "speech_balloon", "comment", "chat"], ["💭", "thought_balloon", "thinking"], ["📧", "email", "mail"],
  ["📞", "telephone_receiver", "call", "phone"], ["💻", "computer", "laptop"], ["🖥️", "desktop_computer"], ["📱", "iphone", "phone", "mobile"],
  ["⌨️", "keyboard"], ["🧪", "test_tube", "test"], ["🧩", "jigsaw", "puzzle"], ["🎯", "dart", "goal", "target"], ["🧭", "compass", "direction"],
  ["🗺️", "world_map", "map", "roadmap"], ["🏁", "checkered_flag", "finish"], ["🚧", "construction", "wip"], ["🔄", "arrows_counterclockwise", "sync", "refresh"],
  ["➕", "heavy_plus_sign", "plus", "add"], ["➖", "heavy_minus_sign", "minus"], ["💰", "moneybag", "money"], ["💸", "money_with_wings", "spend"],
  ["☕", "coffee", "break"], ["🍕", "pizza", "lunch"], ["🍔", "hamburger", "lunch"], ["🍻", "beers", "cheers"], ["🥂", "clinking_glasses", "cheers"],
  ["🎂", "birthday", "cake"], ["☀️", "sunny", "sun"], ["🌙", "crescent_moon", "night"], ["🌈", "rainbow"], ["❄️", "snowflake", "cold"],
  ["🌍", "earth_africa", "world"], ["🌴", "palm_tree", "vacation"], ["✈️", "airplane", "travel"], ["🏠", "house", "home"], ["🏢", "office", "work"],
  ["🐶", "dog"], ["🐱", "cat"], ["🦄", "unicorn"], ["🐢", "turtle", "slow"], ["🙈", "see_no_evil", "oops"], ["💀", "skull", "dead"],
  ["👻", "ghost"], ["🤖", "robot", "bot"], ["👾", "space_invader", "game"], ["🎨", "art", "design"], ["🎵", "musical_note", "music"],
  ["📷", "camera", "photo"], ["🎬", "clapper", "video", "action"], ["💔", "broken_heart"], ["💙", "blue_heart"], ["💚", "green_heart"],
  ["💜", "purple_heart"], ["🧡", "orange_heart"], ["💛", "yellow_heart"], ["🖤", "black_heart"], ["🤍", "white_heart"],
];

export type EmojiEntry = { emoji: string; name: string };

const NAMES = new Map(LIST.map(([emoji, name]) => [name, emoji]));

/** ":thumbsup:" → 👍 (also the other words, so ":+1:" works). */
export function emojiForShortcode(code: string): string | null {
  const key = code.toLowerCase();
  const direct = NAMES.get(key);
  if (direct) return direct;
  const entry = LIST.find(([, , ...words]) => words.includes(key));
  return entry ? entry[0] : null;
}

/** Emoji whose name starts with the query first, then any that mention it. */
export function searchEmoji(query: string, limit = 24): EmojiEntry[] {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!q) return [];
  const rank = ([, name, ...words]: readonly [string, string, ...string[]]) =>
    name.startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : name.includes(q) || words.some((w) => w.includes(q)) ? 2 : -1;
  return LIST.map((entry) => ({ entry, r: rank(entry) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map(({ entry }) => ({ emoji: entry[0], name: entry[1] }));
}

/** 1–3 emoji alone (spaces aside): the message shows them big (40px). */
export function isBigEmoji(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (!compact || compact.length > 48) return false;
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(compact)].map((s) => s.segment);
  // Emoji shown as emoji: their default presentation, a VS16 (❤️), a keycap (1️⃣), a ZWJ family, or a flag pair (not ©, ™, ↔ or a lone letter).
  return parts.length <= 3 && parts.every((part) => {
    const flags = part.match(/\p{Regional_Indicator}/gu);
    if (flags) return flags.length === 2;
    return /\p{Emoji_Presentation}|\uFE0F|\u20E3|\u200D/u.test(part);
  });
}
