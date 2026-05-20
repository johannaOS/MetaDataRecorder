import { Recording, parseTags } from './db';
import { S } from './strings';

export type TagSection = { title: string; data: Recording[] };

/**
 * Groups recordings by tag for the tag-view SectionList.
 * A recording with multiple tags appears under each of its tags.
 * Sections are sorted A→Ö (Swedish locale); untagged recordings
 * always appear last under S.untagged.
 */
export function buildTagSections(recordings: Recording[]): TagSection[] {
  const tagMap = new Map<string, Recording[]>();
  const untagged: Recording[] = [];

  for (const rec of recordings) {
    const tags = parseTags(rec.tags);
    if (tags.length === 0) {
      untagged.push(rec);
    } else {
      for (const tag of tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push(rec);
      }
    }
  }

  const sections: TagSection[] = [...tagMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'sv'))
    .map(([title, data]) => ({ title, data }));

  if (untagged.length > 0) sections.push({ title: S.untagged, data: untagged });
  return sections;
}
