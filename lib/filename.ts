/**
 * Generates a unique, filesystem-safe filename for a recording.
 *
 * Rules:
 *  - Spaces → underscores.
 *  - Any character that is not a letter, digit, underscore, hyphen, or common
 *    Swedish letter (å ä ö Å Ä Ö) is removed.
 *  - If the sanitised result is empty, falls back to "Untitled".
 *  - If `base.m4a` already exists in `existingNames`, appends (1), (2), …
 *    immediately before the extension until the name is unique.
 */
export function generateSafeFilename(
  title: string,
  existingNames: string[] = [],
): string {
  const sanitized = title
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-åäöÅÄÖ]/g, '');

  const base = sanitized || 'Untitled';
  const ext  = '.m4a';

  const candidate = (suffix = '') => `${base}${suffix}${ext}`;

  if (!existingNames.includes(candidate())) return candidate();

  let n = 1;
  while (existingNames.includes(candidate(`(${n})`))) n++;
  return candidate(`(${n})`);
}
