/**
 * Scrape Fish Availability zones from Fischipedia.org
 *
 * Parses {{Fish Availability}} sections from wiki pages to extract
 * the exact sub-zones where each fish spawns.
 *
 * Output:
 *   - Updates src/data/games/fisch/fish.json with availableZones field
 *   - Generates src/data/games/fisch/locations-fish-map.json (zone→fish mapping)
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const BATCH_SIZE = 50;
const DELAY_MS = 1000;
const MAX_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, timeout: 30000 });
      if (!res.ok) {
        if (res.status === 503 || res.headers.get('retry-after')) {
          const wait = parseInt(res.headers.get('retry-after') || '5') * 1000;
          process.stdout.write(` [maxlag, waiting ${wait / 1000}s]`);
          await sleep(wait);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = 1000 * Math.pow(2, attempt - 1);
      process.stdout.write(` [retry ${attempt}]`);
      await sleep(wait);
    }
  }
}

// Step 1: Get all Category:Fish members
async function getAllFishTitles() {
  const titles = [];
  let cmcontinue = '';
  process.stdout.write('Fetching Category:Fish members');
  while (true) {
    let url = `${API}?action=query&list=categorymembers&cmtitle=Category:Fish&cmnamespace=0&cmlimit=500&format=json&maxlag=5`;
    if (cmcontinue) url += `&cmcontinue=${encodeURIComponent(cmcontinue)}`;
    const json = await fetchJson(url);
    json.query.categorymembers.forEach(m => titles.push(m.title));
    process.stdout.write('.');
    if (json.continue) {
      cmcontinue = json.continue.cmcontinue;
      await sleep(DELAY_MS);
    } else break;
  }
  console.log(` ${titles.length} fish`);
  return titles;
}

// Step 2: Download wikitext in batches
async function fetchAllWikitext(allTitles) {
  const results = {};
  const batches = [];
  for (let i = 0; i < allTitles.length; i += BATCH_SIZE)
    batches.push(allTitles.slice(i, i + BATCH_SIZE));

  console.log(`Fetching wikitext: ${batches.length} batches of up to ${BATCH_SIZE}`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`[${i + 1}/${batches.length}] ${batch.length} pages...`);
    try {
      const joined = batch.map(t => encodeURIComponent(t)).join('|');
      const url = `${API}?action=query&prop=revisions&rvprop=content&titles=${joined}&format=json&maxlag=5`;
      const json = await fetchJson(url);
      let count = 0;
      for (const page of Object.values(json.query.pages)) {
        if (page.missing !== undefined) continue;
        const wt = page.revisions && page.revisions[0] && page.revisions[0]['*'];
        if (wt) { results[page.title] = wt; count++; }
      }
      console.log(` ${count} OK`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }
  return results;
}

// Step 3: Parse {{Fish Availability}} from wikitext
function parseFishAvailability(wikitext) {
  const start = wikitext.indexOf('{{Fish Availability');
  if (start === -1) return null;

  // Find the content between {{Fish Availability| and |top_rods (or |admin_events or }})
  const afterStart = wikitext.indexOf('|', start + '{{Fish Availability'.length);
  if (afterStart === -1) return null;

  // Find where zones end (before |top_rods, |admin_events, |recommended, or }})
  const content = wikitext.slice(afterStart + 1);

  // Find the next parameter (|something =) or closing }}
  const paramMatch = content.match(/\n\|(\w+)\s*=/);
  const endIdx = paramMatch ? paramMatch.index : content.indexOf('}}');
  if (endIdx === -1) return null;

  const zoneBlock = content.slice(0, endIdx);

  // Parse zone lines
  const zones = zoneBlock
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      // Skip lines that are wiki markup, comments, or parameters
      if (line.startsWith('|')) return false;
      if (line.startsWith('{{') || line.startsWith('}}')) return false;
      if (line.startsWith('<!--') || line.startsWith('-->')) return false;
      if (line.startsWith('*') || line.startsWith('#')) return false;
      return true;
    })
    // Clean wiki links
    .map(line => line
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .trim()
    )
    .filter(line => line.length > 0 && line.length < 100);

  return zones.length > 0 ? zones : null;
}

// Also extract recommended rod
function parseRecommendedRod(wikitext) {
  const match = wikitext.match(/\|recommended\s*=\s*(.+)/);
  if (!match) return null;
  const val = match[1].trim()
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim();
  return val || null;
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Main
async function main() {
  console.log('=== Fish Availability Scraper ===\n');

  // Step 1: Get all fish titles
  const titles = await getAllFishTitles();

  // Step 2: Download wikitext
  const wikitexts = await fetchAllWikitext(titles);
  console.log(`\nWikitext downloaded: ${Object.keys(wikitexts).length} pages\n`);

  // Step 3: Parse availability from each fish
  const availabilityMap = {}; // fishName -> zones[]
  let withAvail = 0;
  let withoutAvail = 0;

  for (const [title, wikitext] of Object.entries(wikitexts)) {
    const zones = parseFishAvailability(wikitext);
    if (zones && zones.length > 0) {
      availabilityMap[title] = zones;
      withAvail++;
    } else {
      withoutAvail++;
    }
  }

  console.log(`Parsed availability: ${withAvail} with zones, ${withoutAvail} without\n`);

  // Step 4: Load existing fish.json and add availableZones
  const fishFile = path.join(__dirname, '..', '..', '..', 'src', 'data', 'games', 'fisch', 'fish.json');
  const existingFish = JSON.parse(fs.readFileSync(fishFile, 'utf8'));

  let matched = 0;
  let unmatched = 0;

  for (const fish of existingFish) {
    const zones = availabilityMap[fish.name];
    if (zones) {
      fish.availableZones = zones;
      matched++;
    } else {
      fish.availableZones = [];
      unmatched++;
    }
  }

  // Save updated fish.json
  fs.writeFileSync(fishFile, JSON.stringify(existingFish, null, 2));
  console.log(`Updated fish.json: ${matched} matched, ${unmatched} no availability data`);

  // Step 5: Generate locations-fish-map.json (zone → fish mapping)
  const locationMap = {};

  for (const fish of existingFish) {
    if (!fish.availableZones || fish.availableZones.length === 0) continue;

    for (const zone of fish.availableZones) {
      let parent, subZone;

      const slashIdx = zone.indexOf('/');
      if (slashIdx !== -1) {
        parent = zone.slice(0, slashIdx).trim();
        subZone = zone.slice(slashIdx + 1).trim();
      } else {
        parent = zone.trim();
        subZone = '_main'; // No sub-zone, fish is at the main location
      }

      if (!parent) continue;

      if (!locationMap[parent]) {
        locationMap[parent] = { subZones: {} };
      }
      if (!locationMap[parent].subZones[subZone]) {
        locationMap[parent].subZones[subZone] = [];
      }

      locationMap[parent].subZones[subZone].push({
        id: fish.id || slugify(fish.name),
        name: fish.name,
        rarity: fish.rarity,
        imageUrl: fish.imageUrl || null,
      });
    }
  }

  // Sort fish within each sub-zone by rarity
  const RAR_ORD = {
    'Divine Secret':17,'Gemstone':16,'Fragment':15,'Relic':14,'Apex':13,
    'Special':12,'Limited':11,'Extinct':10,'Secret':9,'Exotic':8,
    'Mythical':7,'Legendary':6,'Rare':5,'Unusual':4,'Uncommon':3,'Common':2,'Trash':1,
  };

  for (const loc of Object.values(locationMap)) {
    for (const fishList of Object.values(loc.subZones)) {
      fishList.sort((a, b) => (RAR_ORD[b.rarity] || 0) - (RAR_ORD[a.rarity] || 0));
    }
  }

  // Save locations-fish-map.json
  const mapFile = path.join(__dirname, '..', '..', '..', 'src', 'data', 'games', 'fisch', 'locations-fish-map.json');
  fs.writeFileSync(mapFile, JSON.stringify(locationMap, null, 2));

  // Step 6: Statistics
  const allZones = new Set();
  const parentLocations = new Set();
  const subZonesByParent = {};

  for (const fish of existingFish) {
    for (const zone of (fish.availableZones || [])) {
      allZones.add(zone);
      const slashIdx = zone.indexOf('/');
      if (slashIdx !== -1) {
        const p = zone.slice(0, slashIdx).trim();
        const s = zone.slice(slashIdx + 1).trim();
        parentLocations.add(p);
        if (!subZonesByParent[p]) subZonesByParent[p] = new Set();
        subZonesByParent[p].add(s);
      } else {
        parentLocations.add(zone);
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`STATISTICS`);
  console.log(`========================================`);
  console.log(`Fish in fish.json: ${existingFish.length}`);
  console.log(`Fish with availableZones: ${matched}`);
  console.log(`Fish without availableZones: ${unmatched}`);
  console.log(`\nUnique zones: ${allZones.size}`);
  console.log(`Parent locations: ${parentLocations.size}`);

  // Count total sub-zones
  let totalSubZones = 0;
  const sortedParents = Object.keys(subZonesByParent).sort();
  console.log(`\n--- Sub-zones by location ---`);
  for (const parent of sortedParents) {
    const subs = Array.from(subZonesByParent[parent]).sort();
    totalSubZones += subs.length;
    const fishCount = Object.values(locationMap[parent]?.subZones || {}).reduce((s, a) => s + a.length, 0);
    console.log(`  ${parent} (${fishCount} fish):`);
    for (const sub of subs) {
      const cnt = locationMap[parent]?.subZones[sub]?.length || 0;
      console.log(`    - ${sub} (${cnt} fish)`);
    }
  }

  // Also list parent-only zones (no sub-zone)
  console.log(`\n--- Locations without sub-zones ---`);
  for (const [parent, data] of Object.entries(locationMap)) {
    if (data.subZones['_main']) {
      console.log(`  ${parent}: ${data.subZones['_main'].length} fish (parent-level only)`);
    }
  }

  console.log(`\nTotal unique sub-zones: ${totalSubZones}`);
  console.log(`Locations in map: ${Object.keys(locationMap).length}`);

  console.log(`\nSaved:`);
  console.log(`  ${fishFile}`);
  console.log(`  ${mapFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
