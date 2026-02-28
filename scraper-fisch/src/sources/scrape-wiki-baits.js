const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'static');
const MAX_RETRIES = 3;
const CONCURRENCY = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanWikitext(text) {
  if (!text) return '';
  let s = text;
  s = s.replace(/\{\{Item\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Rarity\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{C\$\|([^}]+)\}\}/g, 'C$$1');
  s = s.replace(/\{\{Robux\|([^}]+)\}\}/g, '$1 Robux');
  s = s.replace(/\{\{[^|}]+\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'{2,3}/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<[^>]+>/g, '');
  return s.trim();
}

/**
 * Get all pages in Category:Bait
 */
async function getCategoryMembers() {
  const pages = [];
  let cmcontinue = '';

  do {
    const url = `${API}?action=query&list=categorymembers&cmtitle=Category:Bait&cmlimit=50&cmtype=page&format=json${cmcontinue ? '&cmcontinue=' + cmcontinue : ''}`;
    const json = await fetchJson(url);
    const members = json.query.categorymembers || [];
    pages.push(...members.map(m => m.title));
    cmcontinue = json.continue?.cmcontinue || '';
  } while (cmcontinue);

  return pages;
}

/**
 * Parse a BaitInfobox from wikitext
 */
function parseBaitInfobox(wikitext) {
  const infoboxMatch = wikitext.match(/\{\{BaitInfobox([\s\S]*?)\}\}/);
  if (!infoboxMatch) return null;

  const content = infoboxMatch[1];
  const fields = {};

  // Parse |field = value lines
  const fieldRegex = /\|\s*(\w+)\s*=\s*(.*)/g;
  let m;
  while ((m = fieldRegex.exec(content)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    if (value) fields[key] = value;
  }

  return fields;
}

/**
 * Parse obtainment section from wikitext
 */
function parseObtainment(wikitext) {
  const obtainMatch = wikitext.match(/==\s*Obtainment\s*==\s*\n([\s\S]*?)(?=\n==|$)/);
  if (!obtainMatch) return null;

  const lines = obtainMatch[1].split('\n')
    .filter(l => l.trim().startsWith('*'))
    .map(l => cleanWikitext(l.replace(/^\*+\s*/, '')).trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : null;
}

/**
 * Parse crates field: "Bait Crate/0.34, Common Crate/0.18"
 */
function parseCrates(cratesStr) {
  if (!cratesStr) return null;
  const crates = [];
  const parts = cratesStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [name, rateStr] = part.split('/').map(s => s.trim());
    if (name) {
      crates.push({
        name,
        rate: rateStr ? parseFloat(rateStr) : null,
      });
    }
  }
  return crates.length > 0 ? crates : null;
}

/**
 * Process a single bait page
 */
async function processBaitPage(title) {
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&maxlag=5`;
  const json = await fetchJson(url);
  const wikitext = json.parse.wikitext['*'];

  const infobox = parseBaitInfobox(wikitext);
  if (!infobox) return null;

  const obtainment = parseObtainment(wikitext);

  // Build image URL from wiki file
  const imageFile = infobox.image || null;
  const imageUrl = imageFile
    ? `https://fischipedia.org/wiki/Special:FilePath/${encodeURIComponent(imageFile)}`
    : null;

  // Extract rarity from template usage in first paragraph
  const rarityMatch = wikitext.match(/\{\{Rarity\|([^}]+)\}\}/);
  const rarity = rarityMatch ? rarityMatch[1].trim() : (infobox.rarity || null);

  return {
    name: title,
    slug: slugify(title),
    rarity: rarity || null,
    imageUrl,
    stats: {
      preferredLuck: infobox.pref_luck ? parseFloat(infobox.pref_luck) : null,
      universalLuck: infobox.univ_luck ? parseFloat(infobox.univ_luck) : null,
      resilience: infobox.resilience ? parseFloat(infobox.resilience) : null,
      lureSpeed: infobox.lure ? parseFloat(infobox.lure) : null,
    },
    ability: infobox.ability || null,
    crates: parseCrates(infobox.crates),
    obtainment: obtainment,
    source: 'fischipedia.org',
  };
}

/**
 * Process pages with concurrency limit
 */
async function processWithConcurrency(pages, concurrency) {
  const results = [];
  let idx = 0;
  let completed = 0;
  const total = pages.length;

  async function worker() {
    while (idx < pages.length) {
      const i = idx++;
      const title = pages[i];
      try {
        const result = await processBaitPage(title);
        if (result) results.push(result);
        completed++;
        if (completed % 10 === 0 || completed === total) {
          process.stdout.write(`\r  ${completed}/${total} pages processed`);
        }
        // Polite delay
        await sleep(200);
      } catch (err) {
        console.error(`\n  Error processing ${title}: ${err.message}`);
        completed++;
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log('');

  return results;
}

async function main() {
  console.log('Scraping baits from fischipedia.org\n');

  // Step 1: Get all bait page titles
  process.stdout.write('Fetching Category:Bait members...');
  const pages = await getCategoryMembers();
  console.log(` ${pages.length} pages found`);

  // Step 2: Fetch and parse each page
  console.log('Processing bait pages...');
  const baits = await processWithConcurrency(pages, CONCURRENCY);

  // Sort alphabetically
  baits.sort((a, b) => a.name.localeCompare(b.name));

  // Save
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, 'baits.json');
  fs.writeFileSync(outFile, JSON.stringify(baits, null, 2));

  // Stats
  const byRarity = {};
  baits.forEach(b => {
    const r = b.rarity || 'Unknown';
    byRarity[r] = (byRarity[r] || 0) + 1;
  });

  const withImage = baits.filter(b => b.imageUrl);
  const withStats = baits.filter(b => b.stats.preferredLuck !== null);
  const withCrates = baits.filter(b => b.crates);
  const withObtain = baits.filter(b => b.obtainment);
  const withAbility = baits.filter(b => b.ability);

  console.log('\n========================================');
  console.log(`Total baits: ${baits.length}`);
  console.log('\nPor rareza:');
  Object.entries(byRarity).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => {
    console.log(`  ${r}: ${n}`);
  });

  console.log('\nCampos extraídos:');
  console.log(`  name:          ${baits.length}/${baits.length}`);
  console.log(`  rarity:        ${baits.filter(b => b.rarity).length}/${baits.length}`);
  console.log(`  imageUrl:      ${withImage.length}/${baits.length}`);
  console.log(`  stats:         ${withStats.length}/${baits.length}`);
  console.log(`  crates:        ${withCrates.length}/${baits.length}`);
  console.log(`  obtainment:    ${withObtain.length}/${baits.length}`);
  console.log(`  ability:       ${withAbility.length}/${baits.length}`);

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
