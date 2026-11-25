/**
 * Report 31.4 C3 calls 8–9 (plan B2.4b): a learner's Syllabus stages and Mistakes, pure. Ticks and mistakes are the
 * learner's own (staff see counts); mistakes reach a mentor only when shared.
 */
export const TOPIC_STAGES = { not_started: "Not started", learning: "Learning", revised: "Revised", confident: "Confident" } as const;
export type TopicStage = keyof typeof TOPIC_STAGES;

export const MISTAKE_REASONS = { careless: "Careless slip", concept: "Didn’t know it", time: "Ran out of time", misread: "Misread the question", unsure: "Not sure why" } as const;
export type MistakeReason = keyof typeof MISTAKE_REASONS;

/** Weak topics: the topics with the most mistakes in the last `days` days (at least 2 each), up to 3. */
export function weakTopics(mistakes: Array<{ topicId: string | null; at: string }>, topics: Array<{ id: string; name: string }>, now = new Date(), days = 30) {
  const since = now.getTime() - days * 86_400_000;
  const counts = new Map<string, number>();
  for (const m of mistakes) if (m.topicId && Date.parse(m.at) >= since) counts.set(m.topicId, (counts.get(m.topicId) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .flatMap(([id, n]) => { const t = topics.find((x) => x.id === id); return t ? [{ id, name: t.name, mistakes: n }] : []; });
}

/** Staff see each topic's stages as counts only (call 9). */
export function stageCounts(rows: Array<{ topicId: string; stage: TopicStage }>, topicIds: string[]) {
  return new Map(topicIds.map((id) => [id, Object.fromEntries((Object.keys(TOPIC_STAGES) as TopicStage[]).map((s) => [s, rows.filter((r) => r.topicId === id && r.stage === s).length])) as Record<TopicStage, number>]));
}
