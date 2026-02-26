const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'static');
const MAX_RETRIES = 3;

// ---- Utils ----

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, timeout: 30000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
}

function normalize(name) {
  return name.toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')  // "Seasonal (Spring)" -> "Seasonal(Spring)"
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseMultiplier(str) {
  if (!str) return null;
  // Handle ranges like "1-1.99×"
  const rangeMatch = str.match(/([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (rangeMatch) {
    return { min: parseFloat(rangeMatch[1]), max: parseFloat(rangeMatch[2]) };
  }
  // Handle single value like "10.2×" or "10×"
  const singleMatch = str.match(/([\d.]+)/);
  if (singleMatch) return parseFloat(singleMatch[1]);
  return null;
}

// ---- Step 1: Parse wiki tables ----

function parseWikiMutations(html) {
  const $ = cheerio.load(html);
  const mutations = [];

  // Section mapping by table order:
  // Table 0: Attributes (Shiny, Sparkling, Big, Giant) - special category
  // Table 1: Standard Mutations (with Appraisable column)
  // Table 2: Admin Event-Only Mutations (no Appraisable column)
  // Table 3: Limited/Event-Only Mutations (with Appraisable column)
  // Table 4: Unobtainable/Removed Mutations

  const tableConfigs = [
    { category: 'attribute',     hasAppraisable: false },
    { category: 'standard',      hasAppraisable: true },
    { category: 'admin',         hasAppraisable: false },
    { category: 'limited',       hasAppraisable: true },
    { category: 'unobtainable',  hasAppraisable: true },
  ];

  $('table').each((tableIdx, table) => {
    if (tableIdx >= tableConfigs.length) return; // skip nav tables

    const config = tableConfigs[tableIdx];
    const rows = $(table).find('tr');

    // Skip header row
    rows.slice(1).each((_, tr) => {
      const cells = $(tr).find('td, th');
      if (cells.length < 2) return;

      let cellIdx = 0;
      const name = $(cells[cellIdx++]).text().trim();
      const multiplierStr = $(cells[cellIdx++]).text().trim();

      let appraisable = null;
      if (config.hasAppraisable && cells.length >= 4) {
        const apprStr = $(cells[cellIdx++]).text().trim();
        appraisable = apprStr === '✓' || apprStr.includes('✓');
      }

      const notes = cellIdx < cells.length ? $(cells[cellIdx]).text().trim() : '';

      if (!name) return;

      const multiplier = parseMultiplier(multiplierStr);

      mutations.push({
        name,
        multiplier,
        category: config.category,
        appraisable,
        notes: notes || null,
        source: 'fischipedia.org',
      });
    });
  });

  return mutations;
}

// ---- Step 2: Merge with calculator data ----

function mergeData(wikiMutations, calcMutations) {
  // Build lookup maps
  const calcMap = new Map();
  for (const m of calcMutations) {
    calcMap.set(normalize(m.name), m);
  }

  const wikiMap = new Map();
  for (const m of wikiMutations) {
    wikiMap.set(normalize(m.name), m);
  }

  const allNames = new Set([...calcMap.keys(), ...wikiMap.keys()]);
  const merged = [];
  let onlyCalc = 0, onlyWiki = 0, both = 0;

  for (const normName of allNames) {
    const calc = calcMap.get(normName) || null;
    const wiki = wikiMap.get(normName) || null;

    if (calc && wiki) both++;
    else if (calc) onlyCalc++;
    else onlyWiki++;

    const name = calc?.name || wiki?.name;

    // Multiplier: prefer calculator's exact number, fallback wiki
    let multiplier;
    if (calc && typeof calc.multiplier === 'number') {
      multiplier = calc.multiplier;
    } else if (wiki) {
      multiplier = wiki.multiplier; // can be number or {min,max} range
    } else {
      multiplier = null;
    }

    // Category: wiki's is more specific (attribute/standard/admin/limited/unobtainable)
    // Calculator has: standard/limited/admin
    const category = wiki?.category || calc?.category || 'unknown';

    // Appraisable: only wiki has this
    const appraisable = wiki?.appraisable ?? null;

    // Obtain method: calculator has short text, wiki has longer notes
    const obtainMethod = calc?.obtainMethod || null;
    const notes = wiki?.notes || null;

    merged.push({
      id: calc?.id || slugify(name),
      name,
      multiplier,
      category,
      appraisable,
      obtainMethod,
      wikiNotes: notes,
      dataSource: {
        calculator: !!calc,
        wiki: !!wiki,
      },
    });
  }

  // Sort by multiplier descending (treat ranges by max, nulls last)
  merged.sort((a, b) => {
    const aVal = typeof a.multiplier === 'number' ? a.multiplier :
      (a.multiplier?.max ?? -Infinity);
    const bVal = typeof b.multiplier === 'number' ? b.multiplier :
      (b.multiplier?.max ?? -Infinity);
    return bVal - aVal;
  });

  return { merged, onlyCalc, onlyWiki, both };
}

// ---- Main ----

async function main() {
  console.log('Scraping mutations from fischipedia.org wiki\n');

  // Step 1: Fetch and parse wiki page
  process.stdout.write('Fetching Mutations page...');
  const url = `${API}?action=parse&page=Mutations&format=json&maxlag=5`;
  const json = await fetchJson(url);
  const html = json.parse.text['*'];
  console.log(` OK (${html.length} chars)`);

  const wikiMutations = parseWikiMutations(html);
  console.log(`Wiki mutations parsed: ${wikiMutations.length}`);

  // Step 2: Read calculator data
  const calcFile = path.join(DATA_DIR, 'mutations.json');
  let calcMutations = [];
  if (fs.existsSync(calcFile)) {
    calcMutations = JSON.parse(fs.readFileSync(calcFile, 'utf8'));
    console.log(`Calculator mutations loaded: ${calcMutations.length}`);
  } else {
    console.log('No calculator mutations file found, proceeding with wiki only');
  }

  // Step 3: Merge
  const { merged, onlyCalc, onlyWiki, both } = mergeData(wikiMutations, calcMutations);

  // Step 4: Save
  const outFile = path.join(DATA_DIR, 'mutations-merged.json');
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));

  // Step 5: Stats
  const byCategory = {};
  merged.forEach(m => {
    const c = m.category;
    byCategory[c] = (byCategory[c] || 0) + 1;
  });

  const withAppraisable = merged.filter(m => m.appraisable !== null);
  const appraisableTrue = merged.filter(m => m.appraisable === true);
  const withNotes = merged.filter(m => m.wikiNotes !== null);
  const withObtain = merged.filter(m => m.obtainMethod !== null);

  console.log('\n========================================');
  console.log(`Total merged: ${merged.length}`);
  console.log(`  En ambas fuentes:  ${both}`);
  console.log(`  Solo calculator:   ${onlyCalc}`);
  console.log(`  Solo wiki:         ${onlyWiki}`);

  console.log(`\nPor categoría:`);
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });

  console.log(`\nCobertura:`);
  console.log(`  appraisable:  ${withAppraisable.length}/${merged.length}`);
  console.log(`  appraisable=true: ${appraisableTrue.length}`);
  console.log(`  wikiNotes:    ${withNotes.length}/${merged.length}`);
  console.log(`  obtainMethod: ${withObtain.length}/${merged.length}`);

  console.log(`\n--- Comparación fuentes ---`);
  console.log(`  Wiki (fischipedia.org):      ${wikiMutations.length} mutaciones`);
  console.log(`  Calculator (fischcalculator): ${calcMutations.length} mutaciones`);
  console.log(`  Merged total:                 ${merged.length} mutaciones`);

  // Show mutations only in wiki (new ones)
  const wikiOnly = merged.filter(m => m.dataSource.wiki && !m.dataSource.calculator);
  if (wikiOnly.length > 0 && wikiOnly.length <= 80) {
    console.log(`\nSolo en wiki (${wikiOnly.length}):`);
    wikiOnly.forEach(m => {
      const mult = typeof m.multiplier === 'number' ? `${m.multiplier}x` :
        (m.multiplier ? `${m.multiplier.min}-${m.multiplier.max}x` : '?');
      console.log(`  ${m.name} (${mult}) [${m.category}]`);
    });
  }

  // Show mutations only in calculator
  const calcOnly = merged.filter(m => m.dataSource.calculator && !m.dataSource.wiki);
  if (calcOnly.length > 0) {
    console.log(`\nSolo en calculator (${calcOnly.length}):`);
    calcOnly.forEach(m => {
      console.log(`  ${m.name} (${m.multiplier}x) [${m.category}]`);
    });
  }

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
