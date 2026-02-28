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
  { src: 'data/static/enchantments.json',       dest: 'enchantments.json' },
  { src: 'data/static/baits.json',              dest: 'baits.json' },
  { src: 'data/static/bobbers.json',            dest: 'bobbers.json' },
];

// Split trade-values.json into rod-skins.json and boats.json
function splitTradeValues() {
  const srcPath = path.join(SCRAPER_ROOT, 'data', 'trade-values.json');
  if (!fs.existsSync(srcPath)) return;

  const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const items = data.items || [];

  const rodSkins = items.filter(i => i.itemType === 'rod_skin');
  const boats = items.filter(i => i.itemType === 'boat');

  const writeJson = (name, arr) => {
    const destPath = path.join(DEST, name);
    fs.writeFileSync(destPath, JSON.stringify(arr, null, 2));
    const size = (fs.statSync(destPath).size / 1024).toFixed(0);
    console.log(`  [OK]   trade-values.json -> ${name} (${size} KB, ${arr.length} items)`);
  };

  writeJson('rod-skins.json', rodSkins);
  writeJson('boats.json', boats);
}

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

  // Split trade values into rod skins and boats
  splitTradeValues();
}

main();
