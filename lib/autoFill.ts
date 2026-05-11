// Detects "efter", "av", or "trad" followed by more text → fills Of/after field.
// Stops at "från" so compound names like "av Axel Samuelsson från Dalarna" produce
// "av Axel Samuelsson" here and "Dalarna" in the From field.
export function extractOfAfter(name: string): string | null {
  const match = name.match(/\b(efter|av|trad\.?)\s+\S.*/i);
  if (!match) return null;
  const raw = match[0];
  const franIdx = raw.search(/\bfrån\b/i);
  const result = franIdx >= 0 ? raw.slice(0, franIdx).trim() : raw.trim();
  return result || null;
}

// Detects "från" followed by more text → fills the From (origin) field.
// Returns only the text after "från ", not the keyword itself.
export function extractOrigin(name: string): string | null {
  const match = name.match(/\bfrån\s+(\S.*)/i);
  return match ? match[1].trim() : null;
}

const SONG_TYPE_KEYWORDS = [
  'slängpolska', 'gånglåt', 'brudmarsch', 'brudlåt',
  'schottis', 'polska', 'hambo', 'reinlender', 'mazurka',
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
