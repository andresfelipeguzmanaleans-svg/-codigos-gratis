const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'static');

// ---- Utils ----

function normalize(name) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Pick the first non-null/non-undefined value from the given values.
 */
function pick(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

/**
 * Pick a numeric value: prefer `a` if it's a real number, else `b`.
 */
function pickNum(a, b) {
  if (typeof a === 'number' && !isNaN(a)) return a;
  if (typeof b === 'number' && !isNaN(b)) return b;
  return null;
}

/**
 * Pick a non-empty string: prefer `a` if truthy, else `b`.
 */
function pickStr(a, b) {
  if (a && typeof a === 'string' && a.trim()) return a.trim();
  if (b && typeof b === 'string' && b.trim()) return b.trim();
  return null;
}

/**
 * Pick a non-empty array: prefer `a` if it has items, else `b`.
 */
function pickArr(a, b) {
  if (Array.isArray(a) && a.length > 0) return a;
  if (Array.isArray(b) && b.length > 0) return b;
  return [];
}

// ---- Merge logic ----

function buildWeightRange(calc, wiki) {
  // Calculator has {min, max} object; wiki has a single number (half-range from base)
  if (calc && calc.weightRange && typeof calc.weightRange === 'object' && calc.weightRange.min != null) {
    return calc.weightRange;
  }
  // Build from wiki: baseWeight ± weightRange
  if (wiki && wiki.baseWeight != null && wiki.weightRange != null) {
    const base = wiki.baseWeight;
    const range = wiki.weightRange;
    return {
      min: Math.round((base - range) * 100) / 100,
      max: Math.round((base + range) * 100) / 100,
    };
  }
  return null;
}

function mergeFish(calc, wiki) {
  const hasCalc = !!calc;
  const hasWiki = !!wiki;

  const name = calc?.name || wiki?.name;
  const id = calc?.id || slugify(name);

  // Rarity: prefer calculator (normalized to match game), fallback wiki
  const rarity = pickStr(calc?.rarity, wiki?.rarity);

  // Numeric data: prefer calculator if exists, else wiki
  const baseValue = pickNum(calc?.baseValue, wiki?.baseValue);
  const baseWeight = pickNum(calc?.baseWeight, wiki?.baseWeight);
  const xp = pickNum(calc?.xp, wiki?.xp);

  // Weight range: calculator has min/max object, wiki has single delta
  const weightRange = buildWeightRange(calc, wiki);

  // Descriptive data: prefer wiki (more detail), fallback calculator
  const location = pickStr(wiki?.location, calc?.location);
  const bait = hasWiki ? pickArr(wiki?.bait) :
    (calc?.bait ? [calc.bait] : []);

  // Wiki-exclusive fields
  const sea = wiki?.sea || null;
  const event = wiki?.event || null;
  const sublocation = wiki?.sublocation || null;
  const sources = pickArr(wiki?.sources);
  const radarCoords = wiki?.radarLocation || null;
  const weather = pickArr(wiki?.weather);
  const time = wiki?.time || null;
  const season = pickArr(wiki?.season);
  const baseChance = pickNum(wiki?.baseChance);
  const baseResil = pickNum(wiki?.baseResil);

  // Calculator-exclusive fields
  const description = pickStr(calc?.description);
  const imageUrl = pickStr(calc?.imageUrl);

  // Wiki image (filename only, can build URL later)
  const image = wiki?.image || null;

  return {
    id,
    name,
    rarity,
    sea,
    location,
    sublocation,
    sources,
    radarCoords,
    xp,
    weather,
    time,
    season,
    bait,
    baseWeight,
    baseValue,
    weightRange,
    baseChance,
    baseResil,
    event,
    description,
    image,
    imageUrl,
    dataSource: {
      calculator: hasCalc,
      wiki: hasWiki,
    },
  };
}

// ---- Main ----

function main() {
  console.log('Merging fish data from fischcalculator.com + fischipedia.org\n');

  // Read sources
  const calcFish = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fish-complete.json'), 'utf8'));
  const wikiFish = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'wiki-fish.json'), 'utf8'));

  console.log(`fischcalculator.com: ${calcFish.length} peces`);
  console.log(`fischipedia.org:     ${wikiFish.length} peces`);

  // Build lookup maps by normalized name
  const calcMap = new Map();
  for (const f of calcFish) {
    calcMap.set(normalize(f.name), f);
  }

  const wikiMap = new Map();
  for (const f of wikiFish) {
    wikiMap.set(normalize(f.name), f);
  }

  // Find all unique names
  const allNames = new Set([...calcMap.keys(), ...wikiMap.keys()]);
  console.log(`Nombres únicos (unión): ${allNames.size}`);

  // Merge
  const merged = [];
  let onlyCalc = 0, onlyWiki = 0, both = 0;

  for (const normName of allNames) {
    const calc = calcMap.get(normName) || null;
    const wiki = wikiMap.get(normName) || null;

    if (calc && wiki) both++;
    else if (calc) onlyCalc++;
    else onlyWiki++;

    merged.push(mergeFish(calc, wiki));
  }

  // Sort by name
  merged.sort((a, b) => a.name.localeCompare(b.name));

  // Save
  const outFile = path.join(DATA_DIR, 'fish-merged.json');
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));

  // ---- Stats ----
  console.log('\n========================================');
  console.log(`Total peces merged: ${merged.length}`);
  console.log(`  En ambas fuentes:    ${both}`);
  console.log(`  Solo calculator:     ${onlyCalc}`);
  console.log(`  Solo wiki:           ${onlyWiki}`);

  // Field coverage
  const fields = [
    ['rarity', f => f.rarity !== null],
    ['location', f => f.location !== null],
    ['xp', f => f.xp !== null],
    ['baseValue', f => f.baseValue !== null],
    ['baseWeight', f => f.baseWeight !== null],
    ['weightRange', f => f.weightRange !== null],
    ['bait', f => f.bait.length > 0],
    ['weather', f => f.weather.length > 0],
    ['time', f => f.time !== null],
    ['season', f => f.season.length > 0],
    ['radarCoords', f => f.radarCoords !== null],
    ['baseChance', f => f.baseChance !== null],
    ['baseResil', f => f.baseResil !== null],
    ['description', f => f.description !== null],
    ['image', f => f.image !== null],
    ['event', f => f.event !== null],
    ['sea', f => f.sea !== null],
    ['sources', f => f.sources.length > 0],
    ['sublocation', f => f.sublocation !== null],
  ];

  console.log(`\nCobertura de campos (de ${merged.length}):`);
  const maxLabel = Math.max(...fields.map(([l]) => l.length));
  for (const [label, fn] of fields) {
    const count = merged.filter(fn).length;
    const pct = ((count / merged.length) * 100).toFixed(1);
    console.log(`  ${label.padEnd(maxLabel)}: ${String(count).padStart(4)}/${merged.length} (${pct}%)`);
  }

  // Rarity distribution
  const rarities = {};
  merged.forEach(f => {
    const r = f.rarity || 'unknown';
    rarities[r] = (rarities[r] || 0) + 1;
  });
  console.log(`\nDistribución por rareza:`);
  Object.entries(rarities).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => {
    console.log(`  ${r}: ${c}`);
  });

  // Show improvement from merge
  console.log(`\n--- Mejora del merge vs solo calculator ---`);
  const calcOnly = merged.filter(f => f.dataSource.calculator);
  const beforeXp = calcFish.filter(f => f.xp !== null).length;
  const afterXp = merged.filter(f => f.xp !== null).length;
  const beforeValue = calcFish.filter(f => f.baseValue !== null).length;
  const afterValue = merged.filter(f => f.baseValue !== null).length;
  const beforeLoc = calcFish.filter(f => f.location !== null).length;
  const afterLoc = merged.filter(f => f.location !== null).length;

  console.log(`  XP:       ${beforeXp} → ${afterXp} (+${afterXp - beforeXp})`);
  console.log(`  Value:    ${beforeValue} → ${afterValue} (+${afterValue - beforeValue})`);
  console.log(`  Location: ${beforeLoc} → ${afterLoc} (+${afterLoc - beforeLoc})`);
  console.log(`  Total:    ${calcFish.length} → ${merged.length} (+${merged.length - calcFish.length} peces nuevos)`);

  console.log(`\nGuardado en ${outFile}`);
}

main();
