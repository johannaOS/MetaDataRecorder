import { generateSafeFilename } from '../lib/filename';

// ── Sanitisation ───────────────────────────────────────────────────────────────

describe('generateSafeFilename — sanitisation', () => {
  it('preserves spaces in the filename', () => {
    expect(generateSafeFilename('Polska efter Erik')).toBe('Polska efter Erik.m4a');
  });

  it('collapses multiple consecutive spaces into one', () => {
    expect(generateSafeFilename('Vals  från  Dalarna')).toBe('Vals från Dalarna.m4a');
  });

  it('strips leading and trailing whitespace before processing', () => {
    expect(generateSafeFilename('  Schottis  ')).toBe('Schottis.m4a');
  });

  it('removes characters that are not letters, digits, spaces, or hyphens', () => {
    expect(generateSafeFilename('Polska! (nr 3)')).toBe('Polska nr 3.m4a');
  });

  it('keeps hyphens', () => {
    expect(generateSafeFilename('Gammal-Polska')).toBe('Gammal-Polska.m4a');
  });

  it('keeps Swedish characters å ä ö Å Ä Ö', () => {
    expect(generateSafeFilename('Polonäs från Dalarna')).toBe('Polonäs från Dalarna.m4a');
    expect(generateSafeFilename('Brudmarschen Åsa')).toBe('Brudmarschen Åsa.m4a');
  });

  it('falls back to "Untitled" when title is empty', () => {
    expect(generateSafeFilename('')).toBe('Untitled.m4a');
    expect(generateSafeFilename('   ')).toBe('Untitled.m4a');
  });

  it('falls back to "Untitled" when all characters are stripped', () => {
    expect(generateSafeFilename('!!!')).toBe('Untitled.m4a');
    expect(generateSafeFilename('@#$%')).toBe('Untitled.m4a');
  });

  it('always adds the .m4a extension', () => {
    expect(generateSafeFilename('Test')).toMatch(/\.m4a$/);
  });
});

// ── Conflict resolution ────────────────────────────────────────────────────────

describe('generateSafeFilename — conflict resolution', () => {
  it('returns the base name when there are no existing files', () => {
    expect(generateSafeFilename('Polska', [])).toBe('Polska.m4a');
  });

  it('appends (1) when the base name already exists', () => {
    expect(generateSafeFilename('Polska', ['Polska.m4a'])).toBe('Polska(1).m4a');
  });

  it('appends (2) when both the base name and (1) already exist', () => {
    expect(generateSafeFilename('Polska', ['Polska.m4a', 'Polska(1).m4a'])).toBe('Polska(2).m4a');
  });

  it('increments until a unique name is found', () => {
    const existing = ['Polska.m4a', 'Polska(1).m4a', 'Polska(2).m4a', 'Polska(3).m4a'];
    expect(generateSafeFilename('Polska', existing)).toBe('Polska(4).m4a');
  });

  it('does not append a suffix when only a (1) variant exists but not the base', () => {
    expect(generateSafeFilename('Polska', ['Polska(1).m4a'])).toBe('Polska.m4a');
  });

  it('handles conflicts on the "Untitled" fallback name', () => {
    expect(generateSafeFilename('', ['Untitled.m4a'])).toBe('Untitled(1).m4a');
    expect(generateSafeFilename('', ['Untitled.m4a', 'Untitled(1).m4a'])).toBe('Untitled(2).m4a');
  });

  it('spaces are preserved before conflict check', () => {
    const existing = ['Polska efter Erik.m4a'];
    expect(generateSafeFilename('Polska efter Erik', existing)).toBe('Polska efter Erik(1).m4a');
  });
});
