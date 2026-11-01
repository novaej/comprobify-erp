export type Clock = { now: () => Date };

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock & { set: (next: string) => void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set: (next) => {
      current = new Date(next);
    },
  };
}
