// Adds `pending` to `tags` if non-empty and not already present.
// Handles the "user typed a tag but tapped Save without pressing Enter" case.
export function commitPendingTag(tags: string[], pending: string): string[] {
  const t = pending.trim();
  if (!t || tags.includes(t)) return tags;
  return [...tags, t];
}
