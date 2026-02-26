const fs = require('fs');
const path = require('path');

const SCRAPER_ROOT = path.join(__dirname, '..');
const ASTRO_ROOT = path.join(SCRAPER_ROOT, '..');
const DEST = path.join(ASTRO_ROOT, 'src', 'data', 'games', 'fisch');

const FILES = [
  { src: 'data/static/fish-merged.json',       dest: 'fish.json' },
  { src: 'data/static/mutations-merged.json',   dest: 'mutations.json' },
  { src: 'data/static/rods.json',               dest: 'rods.json' },
  { src: 'data/static/locations.json',          dest: 'locations.json' },
  { src: 'data/dynamic/trading-values.json',    dest: 'values.json' },
];

function main() {
  // Ensure destination exists
  fs.mkdirSync(DEST, { recursive: true });

  let copied = 0;
  let skipped = 0;

  for (const { src, dest } of FILES) {
    const srcPath = path.join(SCRAPER_ROOT, src);
    const destPath = path.join(DEST, dest);

    if (!fs.existsSync(srcPath)) {
      console.log(`  [SKIP] ${src} (no existe)`);
      skipped++;
      continue;
    }

    fs.copyFileSync(srcPath, destPath);

    const size = (fs.statSync(destPath).size / 1024).toFixed(0);
    console.log(`  [OK]   ${src} -> ${dest} (${size} KB)`);
    copied++;
  }

  console.log(`  Copiados: ${copied}/${FILES.length}${skipped > 0 ? `, ${skipped} saltados` : ''}`);
}

main();
