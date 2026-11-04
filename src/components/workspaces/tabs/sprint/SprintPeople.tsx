"use client";

import { UserAvatar } from "@/components/ui/UserAvatar";
import type { SprintPersonLoad } from "@/lib/workspaces/sprint-detail";

// Sprint redesign §8.2: who carries what in the sprint — open points per person, "heavy" when well above the rest, and
// the work nobody has yet.

/** Heavy: at least 5 points and half again more than the average of everyone else. */
export function isHeavy(person: SprintPersonLoad, people: SprintPersonLoad[]) {
  const others = people.filter((p) => p.id !== person.id);
  if (!others.length || person.openPoints < 5) return false;
  const average = others.reduce((n, p) => n + p.openPoints, 0) / others.length;
  return person.openPoints >= average * 1.5;
}

export function SprintPeople({ people, unassigned }: { people: SprintPersonLoad[]; unassigned: { tasks: number; points: number } }) {
  if (!people.length && !unassigned.tasks) return null;
  return (
    <section aria-labelledby="sprint-people-heading" className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="sprint-people-heading" className="text-sm font-semibold">People</h3>
        <span className="text-[12px] text-muted-foreground">open points</span>
      </div>
      <ul className="mt-1 text-sm">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0">
            <UserAvatar identity={{ id: p.id, fullName: p.name, username: null, avatarUrl: p.avatarUrl }} size={20} roundedClassName="rounded-[5px]" />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className={isHeavy(p, people) ? "text-[12px] text-[var(--status-warning)]" : "text-[12px] text-muted-foreground"}>
              {p.openPoints} · {p.openTasks} {p.openTasks === 1 ? "task" : "tasks"}{isHeavy(p, people) ? " · heavy" : ""}
            </span>
          </li>
        ))}
        {unassigned.tasks ? (
          <li className="flex items-center gap-2 border-t border-border py-1.5 text-muted-foreground">
            <span className="min-w-0 flex-1">Nobody yet</span>
            <span className="text-[12px]">{unassigned.points} · {unassigned.tasks} {unassigned.tasks === 1 ? "task" : "tasks"}</span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
