/** Add `key` to `set`, evicting the oldest entries once it exceeds `max`.
 * A JS Set iterates in insertion order, so the first entry is the oldest.
 * Re-adding an existing key does not refresh its age (dedup only needs
 * "recently seen", and the callers filter on `has` before adding). */
export function addBounded<T>(set: Set<T>, key: T, max: number): void {
  set.add(key);
  while (set.size > max) {
    const oldest = set.values().next().value as T;
    set.delete(oldest);
  }
}
