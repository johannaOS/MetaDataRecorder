// Deterministic color from a tag string — same tag always gets the same color
// on every device, no DB schema change needed.

const PALETTE = [
  '#e53935', // red
  '#e91e63', // pink
  '#9c27b0', // purple
  '#3f51b5', // indigo
  '#2196f3', // blue
  '#00897b', // teal
  '#43a047', // green
  '#f57c00', // orange
  '#795548', // brown
  '#546e7a', // blue-grey
];

export function tagColor(tag: string): { bg: string; text: string } {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = tag.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  const color = PALETTE[Math.abs(h) % PALETTE.length];
  return { bg: color + '22', text: color }; // ~13% opacity background, full color text
}
