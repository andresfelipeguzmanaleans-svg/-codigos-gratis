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

// Split trade-values.json into rod-skins.json and boats.json,
// enriching with price history and computed related items.
function splitTradeValues() {
  const srcPath = path.join(SCRAPER_ROOT, 'data', 'trade-values.json');
  if (!fs.existsSync(srcPath)) return;

  const data = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const items = data.items || [];

  // Load price history / detail data if available
  const detailPath = path.join(SCRAPER_ROOT, 'data', 'trade-details.json');
  let details = {};
  if (fs.existsSync(detailPath)) {
    try {
      details = JSON.parse(fs.readFileSync(detailPath, 'utf8')).items || {};
      console.log(`  [INFO] Loaded trade-details.json (${Object.keys(details).length} items)`);
    } catch { /* ignore */ }
  }

  // Load daily price history if available
  const historyPath = path.join(SCRAPER_ROOT, 'data', 'price-history.json');
  let dailyHistory = {};
  if (fs.existsSync(historyPath)) {
    try {
      dailyHistory = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      console.log(`  [INFO] Loaded price-history.json (${Object.keys(dailyHistory).length} items)`);
    } catch { /* ignore */ }
  }

  // Enrich each item
  const enriched = items.map(item => {
    const slug = item.slug;
    const detail = details[slug];

    // Price history: merge scraped detail history + daily history, dedupe by date
    const histMap = new Map();
    if (detail && detail.priceHistory) {
      detail.priceHistory.forEach(h => histMap.set(h.date, h.value));
    }
    if (dailyHistory[slug]) {
      dailyHistory[slug].forEach(h => histMap.set(h.date, h.value));
    }
    const priceHistory = Array.from(histMap.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      ...item,
      priceHistory: priceHistory.length > 0 ? priceHistory : null,
    };
  });

  // Compute related items (6 closest by value, same type preferred)
  enriched.forEach(item => {
    if (!item.tradeValue) { item.relatedItems = null; return; }
    const candidates = enriched
      .filter(c => c.slug !== item.slug && c.tradeValue)
      .map(c => ({
        name: c.name,
        slug: c.slug,
        value: c.tradeValue,
        imageUrl: c.imageUrl,
        itemType: c.itemType,
        diff: Math.abs(c.tradeValue - item.tradeValue),
        sameType: c.itemType === item.itemType ? 0 : 1,
      }))
      .sort((a, b) => a.sameType - b.sameType || a.diff - b.diff)
      .slice(0, 6);
    item.relatedItems = candidates.map(({ name, slug, value, imageUrl, itemType }) =>
      ({ name, slug, value, imageUrl, itemType }));
  });

  const rodSkins = enriched.filter(i => i.itemType === 'rod_skin');
  const boats = enriched.filter(i => i.itemType === 'boat');

  const writeJson = (name, arr) => {
    const destPath = path.join(DEST, name);
    fs.writeFileSync(destPath, JSON.stringify(arr, null, 2));
    const size = (fs.statSync(destPath).size / 1024).toFixed(0);
    const withHist = arr.filter(i => i.priceHistory && i.priceHistory.length > 0).length;
    console.log(`  [OK]   trade-values.json -> ${name} (${size} KB, ${arr.length} items, ${withHist} with history)`);
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
