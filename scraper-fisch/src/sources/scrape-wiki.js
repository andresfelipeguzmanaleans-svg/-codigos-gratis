const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const BATCH_SIZE = 50;
const DELAY_MS = 1000; // 1 request per second
const MAX_RETRIES = 3;

// ---- Utils ----

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, timeout: 30000 });
      if (!res.ok) {
        // maxlag: MediaWiki asks to wait
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

// ---- Step 1: Get all Category:Fish members ----

async function getAllCategoryMembers() {
  const titles = [];
  let cmcontinue = '';

  process.stdout.write('Fetching Category:Fish members');

  while (true) {
    let url = `${API}?action=query&list=categorymembers&cmtitle=Category:Fish&cmnamespace=0&cmlimit=500&format=json&maxlag=5`;
    if (cmcontinue) url += `&cmcontinue=${encodeURIComponent(cmcontinue)}`;

    const json = await fetchJson(url);
    const members = json.query.categorymembers;
    members.forEach(m => titles.push(m.title));
    process.stdout.write(`.`);

    if (json.continue) {
      cmcontinue = json.continue.cmcontinue;
      await sleep(DELAY_MS);
    } else {
      break;
    }
  }

  console.log(` ${titles.length} peces`);
  return titles;
}

// ---- Step 2: Fetch wikitext in batches of 50 ----

async function fetchWikitextBatch(titles) {
  const joined = titles.map(t => encodeURIComponent(t)).join('|');
  const url = `${API}?action=query&prop=revisions&rvprop=content&titles=${joined}&format=json&maxlag=5`;
  const json = await fetchJson(url);
  return json.query.pages;
}

async function fetchAllWikitext(allTitles) {
  const results = {}; // title -> wikitext
  const batches = [];
  for (let i = 0; i < allTitles.length; i += BATCH_SIZE) {
    batches.push(allTitles.slice(i, i + BATCH_SIZE));
  }

  console.log(`Fetching wikitext: ${batches.length} batches of up to ${BATCH_SIZE}\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const label = `[${i + 1}/${batches.length}]`;
    process.stdout.write(`${label} ${batch.length} pages...`);

    try {
      const pages = await fetchWikitextBatch(batch);
      let parsed = 0;
      for (const page of Object.values(pages)) {
        if (page.missing !== undefined) continue;
        const wikitext = page.revisions?.[0]?.['*'];
        if (wikitext) {
          results[page.title] = wikitext;
          parsed++;
        }
      }
      console.log(` ${parsed} OK`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }

    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  return results;
}

// ---- Step 3: Parse FishInfobox ----

function extractInfobox(wikitext) {
  const start = wikitext.indexOf('{{FishInfobox');
  if (start === -1) return null;

  // Find matching closing }}
  let depth = 0;
  let end = start;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++;
      i++;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  return wikitext.slice(start, end);
}

function parseInfobox(infoboxText) {
  const data = {};
  // Match |key = value lines (value can span until next |key or }})
  const lines = infoboxText.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*\|\s*(\w+)\s*=\s*(.*)/);
    if (!match) continue;
    const key = match[1].trim();
    let val = match[2].trim();
    if (val) data[key] = val;
  }

  return data;
}

function cleanWikiLinks(str) {
  if (!str) return null;
  // [[Link|Display]] -> Display, [[Link]] -> Link
  return str.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .trim() || null;
}

function parseNum(str) {
  if (!str) return null;
  const clean = str.replace(/[,$%]/g, '').trim();
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function parseCoordinates(str) {
  if (!str) return null;
  // {{Coordinates|X|Y|Z}}
  const match = str.match(/\{\{Coordinates\|([^|]+)\|([^|]+)\|([^}]+)\}\}/);
  if (!match) return null;
  return {
    x: parseFloat(match[1]) || 0,
    y: parseFloat(match[2]) || 0,
    z: parseFloat(match[3]) || 0,
  };
}

function parseList(str) {
  if (!str) return [];
  // Split by comma, clean wiki links
  return str.split(',')
    .map(s => cleanWikiLinks(s.trim()))
    .filter(Boolean);
}

function buildFishObject(title, raw) {
  return {
    name: title,
    image: raw.image || null,
    rarity: raw.rarity || null,
    sea: cleanWikiLinks(raw.sea) || null,
    event: cleanWikiLinks(raw.event) || null,
    location: cleanWikiLinks(raw.location) || null,
    sublocation: cleanWikiLinks(raw.sublocation) || null,
    sources: parseList(raw.sources),
    radarLocation: parseCoordinates(raw.radar_location),
    xp: parseNum(raw.xp),
    weather: raw.weather ? parseList(raw.weather) : [],
    time: raw.time || null,
    season: raw.season ? parseList(raw.season) : [],
    bait: parseList(raw.bait),
    baseWeight: parseNum(raw.base_weight),
    baseValue: parseNum(raw.base_value),
    weightRange: parseNum(raw.weight_range),
    baseChance: parseNum(raw.base_chance),
    baseResil: parseNum(raw.base_resil),
    source: 'fischipedia.org',
  };
}

// ---- Main ----

async function main() {
  console.log('Scraping fish from fischipedia.org wiki API\n');

  // Step 1: Get all fish titles
  const titles = await getAllCategoryMembers();

  // Step 2: Fetch wikitext in batches
  const wikitexts = await fetchAllWikitext(titles);
  console.log(`\nWikitext downloaded: ${Object.keys(wikitexts).length} pages`);

  // Step 3: Parse infoboxes
  const fish = [];
  let noInfobox = 0;
  const errors = [];

  for (const [title, wikitext] of Object.entries(wikitexts)) {
    const infoboxText = extractInfobox(wikitext);
    if (!infoboxText) {
      noInfobox++;
      continue;
    }

    try {
      const raw = parseInfobox(infoboxText);
      fish.push(buildFishObject(title, raw));
    } catch (err) {
      errors.push({ title, error: err.message });
    }
  }

  // Sort by name
  fish.sort((a, b) => a.name.localeCompare(b.name));

  // Step 4: Save
  const outFile = path.join(__dirname, '..', '..', 'data', 'static', 'wiki-fish.json');
  fs.writeFileSync(outFile, JSON.stringify(fish, null, 2));

  // Step 5: Summary
  const withXp = fish.filter(f => f.xp !== null);
  const withValue = fish.filter(f => f.baseValue !== null);
  const withWeight = fish.filter(f => f.baseWeight !== null);
  const withLocation = fish.filter(f => f.location !== null);
  const withBait = fish.filter(f => f.bait.length > 0);
  const withRadar = fish.filter(f => f.radarLocation !== null);
  const withImage = fish.filter(f => f.image !== null);

  // Rarity distribution
  const rarities = {};
  fish.forEach(f => {
    const r = f.rarity || 'unknown';
    rarities[r] = (rarities[r] || 0) + 1;
  });

  // Compare with fischcalculator
  let calcCount = 0;
  const calcFile = path.join(__dirname, '..', '..', 'data', 'static', 'fish-list.json');
  if (fs.existsSync(calcFile)) {
    const calcFish = JSON.parse(fs.readFileSync(calcFile, 'utf8'));
    calcCount = calcFish.length;
  }

  console.log('\n========================================');
  console.log(`Category:Fish miembros: ${titles.length}`);
  console.log(`Páginas descargadas: ${Object.keys(wikitexts).length}`);
  console.log(`Con FishInfobox: ${fish.length}`);
  console.log(`Sin FishInfobox: ${noInfobox}`);
  console.log(`Errores de parseo: ${errors.length}`);

  console.log(`\nCobertura de campos:`);
  console.log(`  image:         ${withImage.length}/${fish.length}`);
  console.log(`  xp:            ${withXp.length}/${fish.length}`);
  console.log(`  baseValue:     ${withValue.length}/${fish.length}`);
  console.log(`  baseWeight:    ${withWeight.length}/${fish.length}`);
  console.log(`  location:      ${withLocation.length}/${fish.length}`);
  console.log(`  bait:          ${withBait.length}/${fish.length}`);
  console.log(`  radarLocation: ${withRadar.length}/${fish.length}`);

  console.log(`\nRareza:`);
  Object.entries(rarities).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => {
    console.log(`  ${r}: ${c}`);
  });

  console.log(`\n--- Comparación ---`);
  console.log(`  Wiki (fischipedia.org):         ${fish.length} peces`);
  console.log(`  fischcalculator.com:            ${calcCount} peces`);
  console.log(`  Diferencia:                     +${fish.length - calcCount} en wiki`);

  if (errors.length > 0) {
    console.log(`\nErrores:`);
    errors.forEach(e => console.log(`  ${e.title}: ${e.error}`));
  }

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
