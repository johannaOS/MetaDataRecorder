/**
 * Generates all app icon PNGs from assets/images/icon.svg.
 * Run with: node scripts/generate-icons.js
 *
 * Requires: @resvg/resvg-js (pure WASM, no native compilation needed)
 */

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets', 'images');

function render(svgString, widthPx, outPath) {
  const resvg = new Resvg(svgString, { fitTo: { mode: 'width', value: widthPx } });
  fs.writeFileSync(outPath, resvg.render().asPng());
  console.log(`  ✓  ${path.basename(outPath)}  (${widthPx}×${widthPx})`);
}

// ── Main icon SVG (full colour, with background) ──────────────────────────────
const mainSvg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf-8');

// Notification / monochrome: just the mic silhouette, white on transparent.
// Android uses this as a template icon for notifications.
const monoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect x="186" y="65" width="88" height="145" rx="44" fill="white"/>
  <path d="M 163 200 C 163 335 297 335 297 200"
        stroke="white" stroke-width="16" fill="none"
        stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="230" y1="300" x2="230" y2="355"
        stroke="white" stroke-width="16" stroke-linecap="round"/>
  <line x1="183" y1="355" x2="277" y2="355"
        stroke="white" stroke-width="16" stroke-linecap="round"/>
</svg>`;

console.log('\nGenerating icons…\n');

// iOS / Expo Go main icon
render(mainSvg, 1024, path.join(ASSETS, 'icon.png'));

// Android adaptive foreground (OS applies the mask + background colour)
render(mainSvg, 1024, path.join(ASSETS, 'android-icon-foreground.png'));

// Android monochrome notification icon
render(monoSvg, 512,  path.join(ASSETS, 'android-icon-monochrome.png'));

// Splash screen icon
render(mainSvg, 512,  path.join(ASSETS, 'splash-icon.png'));

// Web favicon
render(mainSvg, 64,   path.join(ASSETS, 'favicon.png'));

console.log('\nDone. Re-run this script whenever icon.svg changes.\n');
