export interface JoinItem {
  exiting?: boolean;
}

export interface JoinCallbacks<D, T extends JoinItem> {
  enter: (key: string, datum: D, index: number) => T;
  /** Called for persisting items AND revived ones (clear exit visuals here). */
  update: (item: T, datum: D, index: number) => void;
  /**
   * Called once when an item starts exiting. Animate out, then call
   * `remove()` — it is a no-op if the item was revived in the meantime.
   */
  exit: (item: T, remove: () => void) => void;
}

/**
 * Minimal keyed enter/update/exit join. Exiting items stay in the map (and
 * the DOM) until their exit animation finishes, and are revived in place if
 * their key comes back — that's what keeps rapid data changes glitch-free.
 */
export function keyedJoin<D, T extends JoinItem>(
  items: Map<string, T>,
  data: ReadonlyArray<readonly [string, D]>,
  cb: JoinCallbacks<D, T>,
): void {
  const seen = new Set<string>();
  data.forEach(([key, datum], i) => {
    seen.add(key);
    const existing = items.get(key);
    if (existing) {
      existing.exiting = false;
      cb.update(existing, datum, i);
    } else {
      const item = cb.enter(key, datum, i);
      item.exiting = false;
      items.set(key, item);
    }
  });
  for (const [key, item] of items) {
    if (!seen.has(key) && !item.exiting) {
      item.exiting = true;
      cb.exit(item, () => {
        if (items.get(key) === item && item.exiting) items.delete(key);
      });
    }
  }
}
