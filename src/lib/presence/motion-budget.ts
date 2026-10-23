/**
 * A shared limit on how many badges run a full change animation at once, so a
 * list refresh does not set a whole page spinning. A slot frees after `holdMs`.
 */
export function createMotionBudget(max: number, holdMs = 1800, schedule: (fn: () => void, ms: number) => unknown = setTimeout) {
  let active = 0;
  return {
    take() {
      if (active >= max) return false;
      active += 1;
      schedule(() => { active -= 1; }, holdMs);
      return true;
    },
  };
}

export const motionBudget = createMotionBudget(16, 900);
