import { commitPendingTag } from '../lib/tagUtils';

describe('commitPendingTag', () => {
  it('adds a new tag to the list', () => {
    expect(commitPendingTag([], 'Polska')).toEqual(['Polska']);
    expect(commitPendingTag(['Vals'], 'Polska')).toEqual(['Vals', 'Polska']);
  });

  it('trims whitespace before adding', () => {
    expect(commitPendingTag([], '  Polska  ')).toEqual(['Polska']);
  });

  it('does not add an empty string', () => {
    expect(commitPendingTag(['Vals'], '')).toEqual(['Vals']);
    expect(commitPendingTag(['Vals'], '   ')).toEqual(['Vals']);
  });

  it('does not add a duplicate', () => {
    expect(commitPendingTag(['Polska'], 'Polska')).toEqual(['Polska']);
  });

  it('returns the same array reference when nothing is added', () => {
    const tags = ['Vals'];
    expect(commitPendingTag(tags, '')).toBe(tags);
    expect(commitPendingTag(tags, 'Vals')).toBe(tags);
  });
});
