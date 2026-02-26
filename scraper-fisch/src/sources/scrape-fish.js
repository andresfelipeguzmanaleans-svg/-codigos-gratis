const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const URL = 'https://fischcalculator.com/tools/trade-calculator/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function scrapeFish() {
  console.log(`Fetching ${URL}...`);
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT } });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // First select contains the fish list (720 items + placeholder)
  const fishList = [];
  $('select').first().find('option').each((_, el) => {
    const value = $(el).attr('value');
    const text = $(el).text().trim();
    if (!value) return; // skip placeholder "Select fish..."

    // Parse "Name (Rarity)" format
    const match = text.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (!match) return;

    const name = match[1].trim();
    const rarity = match[2].trim();

    fishList.push({
      id: toKebabCase(name),
      name,
      rarity,
      sourceId: value,
    });
  });

  // Save to data/static/fish-list.json
  const outDir = path.join(__dirname, '..', '..', 'data', 'static');
  const outFile = path.join(outDir, 'fish-list.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(fishList, null, 2));

  // Print summary
  console.log(`\nTotal peces encontrados: ${fishList.length}`);

  const rarities = {};
  fishList.forEach(f => {
    rarities[f.rarity] = (rarities[f.rarity] || 0) + 1;
  });
  console.log('\nPor rareza:');
  Object.entries(rarities)
    .sort((a, b) => b[1] - a[1])
    .forEach(([r, c]) => console.log(`  ${r}: ${c}`));

  console.log(`\nGuardado en ${outFile}`);
}

scrapeFish().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
