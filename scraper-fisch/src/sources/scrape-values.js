const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SHEET_ID = '1saOLjcowAxI1vkJZkwtgFMAEtmurA68zhCguQN0oBMY';
const MAX_RETRIES = 3;
const DELAY_MS = 500;

// ---- Utils ----

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, headers, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers, timeout: 30000, redirect: 'follow' });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function unescapeJsString(str) {
  return str
    .replace(/\\'/g, "'")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function findJsonBlock(bundleText, identifyFn) {
  const searchStr = "JSON.parse('[";
  let searchIdx = 0;
  while (true) {
    const idx = bundleText.indexOf(searchStr, searchIdx);
    if (idx === -1) return null;
    const jsonStart = idx + searchStr.length - 1;
    const jsonEnd = bundleText.indexOf("]'))", jsonStart);
    if (jsonEnd === -1) { searchIdx = idx + searchStr.length; continue; }
    const candidate = bundleText.slice(jsonStart, jsonEnd + 1);
    if (identifyFn(candidate)) return JSON.parse(unescapeJsString(candidate));
    searchIdx = idx + searchStr.length;
  }
}

// ---- Strategy 1: Google Sheets CSV export ----

async function trySheetsCsv() {
  console.log('--- Strategy 1: Google Sheets CSV export ---');
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
  const res = await fetchWithRetry(url, { 'User-Agent': UA });
  console.log(`  Status: ${res.status}`);
  if (!res.ok) return null;
  const text = await res.text();
  if (text.includes('<!DOCTYPE html>') || text.includes('Sign in')) {
    console.log('  Blocked: login required');
    return null;
  }
  return text;
}

// ---- Strategy 2: Google Sheets gviz JSON ----

async function trySheetsGviz() {
  console.log('--- Strategy 2: Google Sheets gviz JSON ---');
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;
  const res = await fetchWithRetry(url, { 'User-Agent': UA });
  console.log(`  Status: ${res.status}`);
  if (!res.ok) return null;
  const text = await res.text();
  if (text.includes('<!DOCTYPE html>') || text.includes('Sign in')) {
    console.log('  Blocked: login required');
    return null;
  }
  const jsonMatch = text.match(/setResponse\((.+)\);?\s*$/s);
  if (!jsonMatch) return null;
  return JSON.parse(jsonMatch[1]);
}

// ---- Strategy 3: fischcalculator fish bundle (basePrice data) ----

async function tryCalculatorBundle() {
  console.log('--- Strategy 3: fischcalculator.com trade-calculator bundle ---');
  const pageRes = await fetchWithRetry('https://fischcalculator.com/tools/trade-calculator/', { 'User-Agent': UA });
  if (!pageRes.ok) { console.log(`  Page: ${pageRes.status}`); return null; }
  const html = await pageRes.text();
  const $ = cheerio.load(html);
  console.log('  Page fetched OK');

  // Collect all JS chunk URLs
  const bundleUrls = new Set();
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.includes('/_next/static/chunks/')) bundleUrls.add(src);
  });
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    const matches = text.match(/\/_next\/static\/chunks\/[a-f0-9]+\.js/g);
    if (matches) matches.forEach(u => bundleUrls.add(u));
  });

  console.log(`  ${bundleUrls.size} JS bundles to scan`);

  for (const bundlePath of bundleUrls) {
    const res = await fetchWithRetry(`https://fischcalculator.com${bundlePath}`, { 'User-Agent': UA });
    if (!res.ok) continue;
    const text = await res.text();

    if (text.includes('"basePrice"') && text.includes('"spawnConditions"')) {
      const data = findJsonBlock(text,
        c => c.includes('"basePrice"') && c.includes('"rarity"')
      );
      if (data) {
        console.log(`  Found fish data in ${bundlePath.split('/').pop()} (${data.length} items)`);
        return data;
      }
    }
    await sleep(DELAY_MS);
  }

  return null;
}

// ---- Build output ----

function buildFromFishBundle(fishArray) {
  return fishArray
    .filter(f => f.basePrice != null)
    .map(f => {
      const name = f.displayName || f.name;
      const basePrice = f.basePrice;
      const wMin = f.weightRange?.min ?? null;
      const wMax = f.weightRange?.max ?? null;

      // Estimated C$ sell value = basePrice/kg × weight
      let estimatedValue = null;
      if (basePrice && wMin != null && wMax != null) {
        estimatedValue = {
          min: Math.round(basePrice * wMin),
          max: Math.round(basePrice * wMax),
        };
      }

      return {
        itemId: f.id || slugify(name),
        name,
        itemType: 'fish',
        rarity: f.rarity || null,
        basePrice,
        weightRange: wMin != null ? { min: wMin, max: wMax } : null,
        baseCatchRate: f.baseCatchRate ?? null,
        estimatedValue,
        // Not available from this source
        relicValue: null,
        demand: null,
        trend: null,
      };
    });
}

// ---- Main ----

async function main() {
  console.log('Scraping trading values for Fisch\n');

  // Try Google Sheets first
  let csvData = await trySheetsCsv();
  if (csvData) {
    console.log('  Google Sheets CSV accessible!');
    // Would parse CSV here — keeping structure for when sheet becomes public
  }

  let gvizData = !csvData ? await trySheetsGviz() : null;
  if (gvizData) {
    console.log('  Google Sheets gviz accessible!');
  }

  // Fallback: fischcalculator bundle
  let items = [];
  let source = '';

  if (!csvData && !gvizData) {
    console.log('\nGoogle Sheets privado (401). Usando fischcalculator como fallback.\n');
    const fishData = await tryCalculatorBundle();
    if (fishData) {
      source = 'fischcalculator-base-prices';
      items = buildFromFishBundle(fishData);
    }
  }

  if (items.length === 0) {
    console.log('\nNo se encontraron datos de valores.');
    process.exit(1);
  }

  // Sort by estimated max value descending
  items.sort((a, b) => {
    const aVal = a.estimatedValue?.max ?? a.basePrice ?? 0;
    const bVal = b.estimatedValue?.max ?? b.basePrice ?? 0;
    return bVal - aVal;
  });

  // Build output
  const output = {
    lastUpdated: new Date().toISOString(),
    source,
    note: source === 'fischcalculator-base-prices'
      ? 'Google Sheets (relic values) inaccesible. Datos de basePrice (C$/kg) + weightRange del bundle de fischcalculator. estimatedValue = basePrice × peso. No incluye relic values, demand ni trend.'
      : undefined,
    totalItems: items.length,
    items,
  };

  // Save
  const outDir = path.join(__dirname, '..', '..', 'data', 'dynamic');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'trading-values.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  // ---- Stats ----
  const byRarity = {};
  items.forEach(i => {
    const r = i.rarity || 'unknown';
    if (!byRarity[r]) byRarity[r] = { count: 0, values: [] };
    byRarity[r].count++;
    if (i.estimatedValue) byRarity[r].values.push(i.estimatedValue.max);
  });

  const withEstimate = items.filter(i => i.estimatedValue);
  const withCatchRate = items.filter(i => i.baseCatchRate !== null);

  console.log('\n========================================');
  console.log(`Fuente: ${source}`);
  console.log(`Total items con valor: ${items.length}`);

  console.log(`\nCobertura:`);
  console.log(`  basePrice:      ${items.length}/${items.length} (100%)`);
  console.log(`  weightRange:    ${withEstimate.length}/${items.length}`);
  console.log(`  estimatedValue: ${withEstimate.length}/${items.length}`);
  console.log(`  baseCatchRate:  ${withCatchRate.length}/${items.length}`);
  console.log(`  relicValue:     0/${items.length} (sheet privado)`);
  console.log(`  demand/trend:   0/${items.length} (sheet privado)`);

  console.log(`\nPor rareza (valor estimado max C$):`);
  Object.entries(byRarity)
    .sort((a, b) => {
      const aMax = Math.max(...(a[1].values.length ? a[1].values : [0]));
      const bMax = Math.max(...(b[1].values.length ? b[1].values : [0]));
      return bMax - aMax;
    })
    .forEach(([r, d]) => {
      if (d.values.length > 0) {
        const sorted = d.values.sort((a, b) => b - a);
        const top = sorted[0].toLocaleString();
        const median = sorted[Math.floor(sorted.length / 2)].toLocaleString();
        console.log(`  ${r}: ${d.count} peces, max C$${top}, median C$${median}`);
      } else {
        console.log(`  ${r}: ${d.count} peces, sin rango de peso`);
      }
    });

  console.log(`\nTop 10 peces más valiosos (C$ estimado max):`);
  items.filter(i => i.estimatedValue).slice(0, 10).forEach(i => {
    console.log(`  ${i.name} [${i.rarity}]: C$${i.estimatedValue.max.toLocaleString()} (${i.basePrice}/kg × ${i.weightRange.max}kg)`);
  });

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
