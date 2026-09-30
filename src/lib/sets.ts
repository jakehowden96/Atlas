/** A copy of `set` with `value` removed if it was present and added if not.
 *  Components hold sets in `$state` and replace them wholesale rather than
 *  mutate, so a toggle has to hand back a new set. */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}
