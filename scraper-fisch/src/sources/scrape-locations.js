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

/**
 * Find all JSON.parse('[...]') blocks in a JS bundle and return the one
 * where the given identifyFn returns true.
 */
function findJsonBlock(bundleText, identifyFn) {
  const searchStr = "JSON.parse('[";
  let searchIdx = 0;

  while (true) {
    const idx = bundleText.indexOf(searchStr, searchIdx);
    if (idx === -1) return null;

    const jsonStart = idx + searchStr.length - 1;
    const jsonEnd = bundleText.indexOf("]'))", jsonStart);
    if (jsonEnd === -1) {
      searchIdx = idx + searchStr.length;
      continue;
    }

    const candidate = bundleText.slice(jsonStart, jsonEnd + 1);
    if (identifyFn(candidate)) {
      return JSON.parse(unescapeJsString(candidate));
    }

    searchIdx = idx + searchStr.length;
  }
}

// ---- Extraction ----

/**
 * Extract location and fish data from fischcalculator.com JS bundles.
 *
 * The main data bundle contains:
 *  - Locations: identified by "availableWeathers" field
 *  - Fish: identified by "basePrice" + "spawnConditions" fields
 *
 * We combine both: each location gets enriched with the list of fish
 * that spawn there (derived from each fish's spawnConditions.locations).
 */
async function extractData(html) {
  const $ = cheerio.load(html);

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

  console.log(`Found ${bundleUrls.size} JS bundle URLs to check`);

  let locations = null;
  let fish = null;

  for (const bundlePath of bundleUrls) {
    if (locations && fish) break;

    const bundleUrl = `https://fischcalculator.com${bundlePath}`;
    process.stdout.write(`  Checking ${bundlePath.split('/').pop()}...`);

    const res = await fetchWithRetry(bundleUrl);
    if (!res.ok) {
      console.log(` ${res.status}`);
      await sleep(DELAY_MS);
      continue;
    }

    const text = await res.text();
    const found = [];

    // Look for locations block (has "availableWeathers")
    if (!locations) {
      const locData = findJsonBlock(text,
        c => c.includes('"availableWeathers"')
      );
      if (locData) {
        locations = locData;
        found.push(`locations(${locData.length})`);
      }
    }

    // Look for fish block (has "basePrice" + "spawnConditions")
    if (!fish) {
      const fishData = findJsonBlock(text,
        c => c.includes('"basePrice"') && c.includes('"spawnConditions"')
      );
      if (fishData) {
        fish = fishData;
        found.push(`fish(${fishData.length})`);
      }
    }

    if (found.length > 0) {
      console.log(` FOUND ${found.join(', ')}`);
    } else {
      console.log(` no location/fish data`);
    }

    await sleep(DELAY_MS);
  }

  return { locations, fish };
}

// ---- Main ----

async function main() {
  console.log('Scraping locations from fischcalculator.com/database/locations/\n');

  // Step 1: Fetch the locations page
  process.stdout.write('Fetching locations page...');
  const pageRes = await fetchWithRetry('https://fischcalculator.com/database/locations/');
  if (!pageRes.ok) {
    throw new Error(`Page returned HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  console.log(' OK');

  // Step 2: Extract data from JS bundles
  console.log('\nSearching JS bundles...');
  const { locations: rawLocations, fish: rawFish } = await extractData(html);

  if (!rawLocations || rawLocations.length === 0) {
    throw new Error('No location data found in any JS bundle');
  }

  console.log(`\nRaw locations: ${rawLocations.length}`);
  console.log(`Raw fish: ${rawFish ? rawFish.length : 0}`);

  // Step 3: Build fish-per-location index from fish spawn data
  const fishByLocation = {};
  if (rawFish) {
    for (const f of rawFish) {
      if (!f.spawnConditions || !f.spawnConditions.locations) continue;
      for (const locId of f.spawnConditions.locations) {
        if (!fishByLocation[locId]) fishByLocation[locId] = [];
        fishByLocation[locId].push({
          name: f.displayName || f.name,
          rarity: f.rarity,
        });
      }
    }
  }

  // Step 4: Combine location metadata with fish lists
  const locations = rawLocations.map(loc => {
    const locFish = fishByLocation[loc.id] || [];
    // Sort fish by rarity tier then name
    const rarityOrder = {
      Apex: 0, Secret: 1, Exotic: 2, Mythical: 3, Legendary: 4,
      Rare: 5, Uncommon: 6, Common: 7, Special: 8, Limited: 9,
    };
    locFish.sort((a, b) => {
      const ra = rarityOrder[a.rarity] ?? 99;
      const rb = rarityOrder[b.rarity] ?? 99;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });

    return {
      id: loc.id,
      name: loc.displayName || loc.name,
      description: loc.description || null,
      availableWeathers: loc.availableWeathers || [],
      isPremium: loc.isPremium || false,
      isEvent: loc.isEvent || false,
      isSeasonal: loc.isSeasonal || false,
      fishCount: locFish.length,
      fish: locFish,
      source: 'fischcalculator.com',
    };
  });

  // Sort: standard locations first (by fish count desc), then events
  locations.sort((a, b) => {
    if (a.isEvent !== b.isEvent) return a.isEvent ? 1 : -1;
    return b.fishCount - a.fishCount;
  });

  // Step 5: Save
  const outFile = path.join(__dirname, '..', '..', 'data', 'static', 'locations.json');
  fs.writeFileSync(outFile, JSON.stringify(locations, null, 2));

  // Step 6: Summary
  const standard = locations.filter(l => !l.isEvent);
  const events = locations.filter(l => l.isEvent);
  const premium = locations.filter(l => l.isPremium);
  const withFish = locations.filter(l => l.fishCount > 0);
  const totalFishAssigned = locations.reduce((s, l) => s + l.fishCount, 0);

  console.log('\n========================================');
  console.log(`Total ubicaciones: ${locations.length}`);
  console.log(`  Estándar: ${standard.length}`);
  console.log(`  Evento: ${events.length}`);
  console.log(`  Premium: ${premium.length}`);
  console.log(`  Con peces: ${withFish.length}`);
  console.log(`  Total peces asignados: ${totalFishAssigned} (de ${rawFish ? rawFish.length : '?'} peces)`);

  console.log(`\nTop 10 por cantidad de peces:`);
  locations.slice(0, 10).forEach(l => {
    const flags = [];
    if (l.isPremium) flags.push('PREMIUM');
    if (l.isEvent) flags.push('EVENT');
    const tag = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    console.log(`  ${l.name}: ${l.fishCount} peces${tag}`);
  });

  console.log(`\nNota: nivel requerido no disponible en la fuente de datos`);
  console.log(`Guardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
