import { buildTagSections } from '../lib/tagSections';
import type { Recording } from '../lib/db';

function rec(id: number, tags: string[]): Recording {
  return {
    id, name: `Rec ${id}`, filePath: '', duration: 0,
    createdAt: '', ofAfter: '', origin: '', songType: '',
    performer: '', notes: '', customData: '{}',
    tags: JSON.stringify(tags),
  };
}

describe('buildTagSections', () => {
  it('returns empty array for empty input', () => {
    expect(buildTagSections([])).toEqual([]);
  });

  it('puts untagged recordings into the Utan tagg section only', () => {
    const sections = buildTagSections([rec(1, []), rec(2, [])]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Utan tagg');
    expect(sections[0].data).toHaveLength(2);
  });

  it('creates one section per tag', () => {
    const sections = buildTagSections([rec(1, ['Vals']), rec(2, ['Polska'])]);
    const titles = sections.map(s => s.title);
    expect(titles).toContain('Vals');
    expect(titles).toContain('Polska');
    expect(titles).not.toContain('Utan tagg');
  });

  it('places a multi-tagged recording under each of its tags', () => {
    const r = rec(1, ['Vals', 'Polska']);
    const sections = buildTagSections([r]);
    expect(sections).toHaveLength(2);
    expect(sections.every(s => s.data[0].id === 1)).toBe(true);
  });

  it('sorts tagged sections alphabetically (Swedish locale) before Utan tagg', () => {
    const sections = buildTagSections([
      rec(1, []),
      rec(2, ['Öländsk polska']),
      rec(3, ['Schottis']),
      rec(4, ['Polska']),
    ]);
    const titles = sections.map(s => s.title);
    // Swedish: Polska < Schottis < Öländsk polska, then Utan tagg last
    expect(titles).toEqual(['Polska', 'Schottis', 'Öländsk polska', 'Utan tagg']);
  });

  it('Utan tagg section is always last even with many tags', () => {
    const sections = buildTagSections([
      rec(1, ['Vals']),
      rec(2, []),
      rec(3, ['Polska']),
    ]);
    expect(sections[sections.length - 1].title).toBe('Utan tagg');
  });

  it('handles empty tags string the same as no tags', () => {
    const r: Recording = { ...rec(1, []), tags: '' };
    const sections = buildTagSections([r]);
    expect(sections[0].title).toBe('Utan tagg');
  });

  it('handles malformed tags JSON without throwing', () => {
    const r: Recording = { ...rec(1, []), tags: 'not-json' };
    const sections = buildTagSections([r]);
    expect(sections[0].title).toBe('Utan tagg');
  });

  it('groups multiple recordings under the same tag', () => {
    const sections = buildTagSections([rec(1, ['Vals']), rec(2, ['Vals']), rec(3, ['Vals'])]);
    expect(sections).toHaveLength(1);
    expect(sections[0].data).toHaveLength(3);
  });
});
