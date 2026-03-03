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

  // Replace external game.guide imageUrls with local paths
  const ASTRO_PUBLIC = path.join(ASTRO_ROOT, 'public');
  enriched.forEach(item => {
    const folder = item.itemType === 'boat' ? 'boats' : 'rod-skins';
    const localPath = `/images/${folder}/${item.slug}.png`;
    if (fs.existsSync(path.join(ASTRO_PUBLIC, localPath))) {
      item.imageUrl = localPath;
    }
    // Also fix relatedItems imageUrls
    if (item.relatedItems) {
      item.relatedItems.forEach(rel => {
        const relFolder = rel.itemType === 'boat' ? 'boats' : 'rod-skins';
        const relLocal = `/images/${relFolder}/${rel.slug}.png`;
        if (fs.existsSync(path.join(ASTRO_PUBLIC, relLocal))) {
          rel.imageUrl = relLocal;
        }
      });
    }
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

// Merge locations: preserve manually-added coords, imagePath, and extra locations
// that exist in the destination but not in the scraper source.
function mergeLocations(srcPath, destPath) {
  const srcData = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

  // Load existing destination data if it exists
  let existingMap = {};
  if (fs.existsSync(destPath)) {
    const existing = JSON.parse(fs.readFileSync(destPath, 'utf8'));
    existing.forEach(l => { existingMap[l.id] = l; });
  }

  // Merge: scraper data wins for most fields, but preserve coords/imagePath from existing
  const srcIds = new Set();
  srcData.forEach(loc => {
    srcIds.add(loc.id);
    const prev = existingMap[loc.id];
    if (prev) {
      if (!loc.coords && prev.coords) loc.coords = prev.coords;
      if (!loc.imagePath && prev.imagePath) loc.imagePath = prev.imagePath;
    }
  });

  // Add back locations that exist in destination but not in scraper source
  let added = 0;
  Object.values(existingMap).forEach(prev => {
    if (!srcIds.has(prev.id)) {
      srcData.push(prev);
      added++;
    }
  });

  fs.writeFileSync(destPath, JSON.stringify(srcData, null, 2));
  const size = (fs.statSync(destPath).size / 1024).toFixed(0);
  const withCoords = srcData.filter(l => l.coords).length;
  const withImg = srcData.filter(l => l.imagePath).length;
  console.log(`  [OK]   locations.json merged (${size} KB, ${srcData.length} locs, ${withCoords} coords, ${withImg} imgs${added > 0 ? `, ${added} extra preserved` : ''})`);
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

    // Special merge for locations to preserve coords/imagePath
    if (dest === 'locations.json') {
      mergeLocations(srcPath, destPath);
      copied++;
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
