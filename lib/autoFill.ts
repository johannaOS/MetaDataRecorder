// Detects "efter", "av", or "trad" followed by more text → fills Of/after field.
// Stops at "från" and limits result to the keyword plus at most 2 words.
export function extractOfAfter(name: string): string | null {
  const match = name.match(/\b(efter|av|trad\.?)\s+\S.*/i);
  if (!match) return null;
  let raw = match[0];
  const franIdx = raw.search(/\bfrån\b/i);
  if (franIdx >= 0) raw = raw.slice(0, franIdx).trim();
  // keyword + up to 2 words
  const parts = raw.split(/\s+/);
  const result = parts.slice(0, 3).join(' ').trim();
  return result || null;
}

// Detects "från" followed by text → fills the From (origin) field.
// Returns only the first word after "från" (trailing punctuation stripped).
export function extractOrigin(name: string): string | null {
  const match = name.match(/\bfrån\s+(\S+)/i);
  if (!match) return null;
  return match[1].replace(/[.,;:!?]+$/, '') || null;
}

const SONG_TYPE_KEYWORDS = [
  'slängpolska', 'gånglåt', 'brudmarsch', 'brudlåt',
  'schottis', 'polonäs', 'polska', 'hambo', 'reinlender', 'mazurka',
  'marsch', 'vals', 'visa', 'låt',
];

export function extractSongType(name: string): string | null {
  const lower = name.toLowerCase();
  for (const kw of SONG_TYPE_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    const before = idx > 0 ? lower[idx - 1] : null;
    const after  = idx + kw.length < lower.length ? lower[idx + kw.length] : null;
    const okBefore = before === null || /[^a-zåäö]/.test(before);
    const okAfter  = after  === null || /[^a-zåäö]/.test(after);
    if (okBefore && okAfter) return kw.charAt(0).toUpperCase() + kw.slice(1);
  }
  return null;
}
