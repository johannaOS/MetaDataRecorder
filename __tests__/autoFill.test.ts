import { extractOfAfter, extractOrigin, extractSongType } from '../lib/autoFill';

// ── extractOfAfter ────────────────────────────────────────────────────────────

describe('extractOfAfter', () => {
  it('detects "efter" followed by a name', () => {
    expect(extractOfAfter('Polska efter Erik Jonsson')).toBe('efter Erik Jonsson');
  });

  it('detects "av" followed by a name', () => {
    expect(extractOfAfter('Polska av Spelmannen')).toBe('av Spelmannen');
  });

  it('detects "trad." keyword', () => {
    expect(extractOfAfter('Schottis Trad. gammaldans')).toBe('Trad. gammaldans');
  });

  it('does NOT detect "från" (that belongs in the From field)', () => {
    expect(extractOfAfter('Polska från Dalarna')).toBeNull();
  });

  it('returns null when no keyword is present', () => {
    expect(extractOfAfter('Polska')).toBeNull();
    expect(extractOfAfter('')).toBeNull();
  });

  it('requires text after the keyword to count as a match', () => {
    expect(extractOfAfter('Polska efter')).toBeNull();
    expect(extractOfAfter('Polska av')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractOfAfter('Polska EFTER Erik')).not.toBeNull();
    expect(extractOfAfter('Polska AV Nils')).not.toBeNull();
  });

  it('includes everything from the keyword to end of string when no "från"', () => {
    expect(extractOfAfter('Brudmarsch efter Lena Larsson i Malung')).toBe(
      'efter Lena Larsson i Malung'
    );
  });

  // ── Compound "av … från" cases ────────────────────────────────────────────

  it('stops at "från" — exact case from spec', () => {
    expect(extractOfAfter('av Axel Samuelsson från Dalarna')).toBe('av Axel Samuelsson');
  });

  it('stops at "från" with "efter" keyword', () => {
    expect(extractOfAfter('Polska efter Erik från Lima')).toBe('efter Erik');
  });

  it('stops at "från" and returns non-null when name text exists before "från"', () => {
    expect(extractOfAfter('Schottis av Spelman från Rättvik')).toBe('av Spelman');
  });

  it('returns the keyword alone when name immediately follows with "från" (no performer between)', () => {
    // "av från Dalarna" — "av" is captured but nothing useful follows before "från"
    // The function still returns "av" (not null); the UI treats a bare keyword gracefully.
    // This edge case does not produce a false negative for extractOrigin.
    expect(extractOfAfter('Vals av från Dalarna')).toBe('av');
    expect(extractOrigin('Vals av från Dalarna')).toBe('Dalarna');
  });
});

// ── extractOrigin ─────────────────────────────────────────────────────────────

describe('extractOrigin', () => {
  it('detects "från" followed by a place name', () => {
    expect(extractOrigin('Polska från Dalarna')).toBe('Dalarna');
  });

  it('detects Lima (village in Dalarna)', () => {
    expect(extractOrigin('Schottis från Lima')).toBe('Lima');
  });

  it('detects Malung', () => {
    expect(extractOrigin('Vals från Malung')).toBe('Malung');
  });

  it('captures multi-word origins', () => {
    expect(extractOrigin('Polska från Dalarna, Sverige')).toBe('Dalarna, Sverige');
  });

  it('returns null when no "från" keyword is present', () => {
    expect(extractOrigin('Polska efter Erik')).toBeNull();
    expect(extractOrigin('Polska')).toBeNull();
    expect(extractOrigin('')).toBeNull();
  });

  it('extracts origin from compound "av … från" name — exact case from spec', () => {
    expect(extractOrigin('av Axel Samuelsson från Dalarna')).toBe('Dalarna');
  });

  it('works together with extractOfAfter on compound names', () => {
    const name = 'Polska av Spelman från Rättvik';
    expect(extractOrigin(name)).toBe('Rättvik');
    // extractOfAfter is tested separately; just confirm no interference here
    expect(extractOrigin('Schottis efter Erik från Lima')).toBe('Lima');
  });

  it('returns null when "från" has no following text', () => {
    expect(extractOrigin('Polska från')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(extractOrigin('Polska FRÅN Dalarna')).toBe('Dalarna');
  });

  it('returns only the text AFTER "från", not the keyword itself', () => {
    const result = extractOrigin('Schottis från Rättvik');
    expect(result).toBe('Rättvik');
    expect(result).not.toContain('från');
  });
});

// ── extractSongType ───────────────────────────────────────────────────────────

describe('extractSongType', () => {
  it.each([
    ['Schottis i G-dur', 'Schottis'],
    ['Polska efter Erik', 'Polska'],
    ['Gammal vals', 'Vals'],
    ['En marsch i G-dur', 'Marsch'],
    ['Gånglåt från Dalarna', 'Gånglåt'],
    ['Visa om sommaren', 'Visa'],
    ['Hambo polka', 'Hambo'],
  ])('detects %s → %s', (input, expected) => {
    expect(extractSongType(input)).toBe(expected);
  });

  it('prefers compound type "slängpolska" over "polska"', () => {
    expect(extractSongType('Slängpolska från Rättvik')).toBe('Slängpolska');
  });

  it('prefers "brudmarsch" over "marsch"', () => {
    expect(extractSongType('Brudmarsch från Lima')).toBe('Brudmarsch');
  });

  it('is case-insensitive and returns capitalised result', () => {
    expect(extractSongType('SCHOTTIS')).toBe('Schottis');
    expect(extractSongType('gammal POLSKA')).toBe('Polska');
  });

  it('returns null when no song type is found', () => {
    expect(extractSongType('En gammal melodi')).toBeNull();
    expect(extractSongType('')).toBeNull();
  });

  it('does not match partial words (no false positives)', () => {
    // "välsgott" should not match "vals"
    expect(extractSongType('välsgott')).toBeNull();
  });
});
