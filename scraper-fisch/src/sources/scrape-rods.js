const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_RETRIES = 3;
const DELAY_MS = 500;

// ---- Utils ----

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = 1000 * Math.pow(2, attempt - 1);
      process.stdout.write(` retry ${attempt}...`);
      await sleep(wait);
    }
  }
}

function unescapeJsString(str) {
  return str
    .replace(/\\'/g, "'")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ---- Extraction ----

/**
 * Extract rod data from the fischcalculator.com JS bundles.
 * The site is a Next.js app that embeds all game data as JSON.parse() calls
 * inside webpack modules. Rod data is identified by the "luckBonus" field
 * (unique to rods; mutations use "multiplier", fish use "basePrice").
 */
async function extractRodsFromBundles(html) {
  const $ = cheerio.load(html);

  // Collect all JS chunk URLs from the page
  const bundleUrls = new Set();
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.includes('/_next/static/chunks/')) {
      bundleUrls.add(src);
    }
  });
  // Also extract chunk URLs from RSC payload (inline scripts)
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    const matches = text.match(/\/_next\/static\/chunks\/[a-f0-9]+\.js/g);
    if (matches) matches.forEach(u => bundleUrls.add(u));
  });

  console.log(`Found ${bundleUrls.size} JS bundle URLs to check`);

  for (const bundlePath of bundleUrls) {
    const bundleUrl = `https://fischcalculator.com${bundlePath}`;
    process.stdout.write(`  Checking ${bundlePath.split('/').pop()}...`);

    const res = await fetchWithRetry(bundleUrl);
    if (!res.ok) {
      console.log(` ${res.status}`);
      await sleep(DELAY_MS);
      continue;
    }

    const text = await res.text();

    // Search for JSON.parse('[...luckBonus...]') blocks that are rod data
    // (not mutation data which has "multiplier", not fish data which has "basePrice")
    const searchStr = "JSON.parse('[";
    let searchIdx = 0;

    while (true) {
      const idx = text.indexOf(searchStr, searchIdx);
      if (idx === -1) break;

      const jsonStart = idx + searchStr.length - 1; // start at [
      const jsonEnd = text.indexOf("]'))", jsonStart);
      if (jsonEnd === -1) {
        searchIdx = idx + searchStr.length;
        continue;
      }

      const candidate = text.slice(jsonStart, jsonEnd + 1);

      // Rod data has "luckBonus" but NOT "multiplier" (mutations) or "basePrice" (fish)
      if (candidate.includes('"luckBonus"') && !candidate.includes('"multiplier"') && !candidate.includes('"basePrice"')) {
        console.log(` FOUND rod data! (${candidate.length} chars)`);
        const jsonStr = unescapeJsString(candidate);
        return JSON.parse(jsonStr);
      }

      searchIdx = idx + searchStr.length;
    }

    console.log(` no rod data`);
    await sleep(DELAY_MS);
  }

  return null;
}

// ---- Main ----

async function main() {
  console.log('Scraping rods from fischcalculator.com/tools/rod-advisor/\n');

  // Step 1: Fetch the rod advisor page
  process.stdout.write('Fetching rod advisor page...');
  const pageRes = await fetchWithRetry('https://fischcalculator.com/tools/rod-advisor/');
  if (!pageRes.ok) {
    throw new Error(`Page returned HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  console.log(' OK');

  // Step 2: Extract rods from JS bundles
  console.log('\nSearching JS bundles for rod data...');
  const rawRods = await extractRodsFromBundles(html);

  if (!rawRods || rawRods.length === 0) {
    throw new Error('No rod data found in any JS bundle');
  }

  console.log(`\nRaw rods extracted: ${rawRods.length}`);

  // Step 3: Clean and format
  const rods = rawRods.map(r => ({
    id: r.id,
    name: r.displayName || r.name,
    luckBonus: r.luckBonus ?? null,
    control: r.control ?? null,
    resilience: r.resilience ?? null,
    lureSpeed: r.lureSpeed ?? null,
    obtainMethod: r.obtainMethod || null,
    source: 'fischcalculator.com',
  }));

  // Sort by luckBonus descending (best rods first)
  rods.sort((a, b) => (b.luckBonus || 0) - (a.luckBonus || 0));

  // Step 4: Save
  const outFile = path.join(__dirname, '..', '..', 'data', 'static', 'rods.json');
  fs.writeFileSync(outFile, JSON.stringify(rods, null, 2));

  // Step 5: Summary
  console.log('\n========================================');
  console.log(`Total cañas: ${rods.length}`);

  const withStats = rods.filter(r => r.luckBonus !== 0 || r.control !== 0 || r.resilience !== 0 || r.lureSpeed !== 0);
  const zeroStats = rods.filter(r => r.luckBonus === 0 && r.control === 0 && r.resilience === 0 && r.lureSpeed === 0);
  console.log(`Con stats: ${withStats.length}`);
  console.log(`Stats en cero: ${zeroStats.length}`);

  console.log(`\nTop 10 por Luck Bonus:`);
  rods.slice(0, 10).forEach(r => {
    console.log(`  ${r.name}: luck=${r.luckBonus}, ctrl=${r.control}, res=${r.resilience}, lure=${r.lureSpeed}`);
  });

  console.log(`\nCampos disponibles: id, name, luckBonus, control, resilience, lureSpeed, obtainMethod`);
  console.log(`Nota: maxKg, disturbance y lineDistance no están disponibles en la fuente`);
  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
