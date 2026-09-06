/** Structural equality for plain JSON-shaped values (what the API returns).
 * Used to keep the PREVIOUS state object when a poll returns byte-identical
 * data, so consumers memoising on `state` do not re-render every 15 s. Cheap
 * relative to the render it prevents: a StateDTO is a few KB of plain JSON. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
