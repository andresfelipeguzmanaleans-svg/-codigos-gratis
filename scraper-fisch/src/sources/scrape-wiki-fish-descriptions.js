/**
 * Scrape fish lore/descriptions from fischipedia.org wiki.
 *
 * For each fish in fish-merged.json, fetches its wiki page via MediaWiki API,
 * extracts narrative text (lore), the obtainment/source field from FishInfobox,
 * and detects special catch mechanics.
 *
 * Output: scraper-fisch/data/static/wiki-descriptions.json
 *
 * Rate limit: 1 request/second (~21 min for 1,235 fish).
 * Saves progress every 50 fish.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'static');
const OUT_FILE = path.join(DATA_DIR, 'wiki-descriptions.json');
const MAX_RETRIES = 3;
const DELAY_MS = 1000; // 1 request per second
const SAVE_EVERY = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Fetch with retries + maxlag ----

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

// ---- Wiki markup cleaning ----

function cleanWikitext(text) {
  if (!text) return '';
  let s = text;
  // Named templates with display text
  s = s.replace(/\{\{Item\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Rarity\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{C\$\|([^}]+)\}\}/g, 'C$$1');
  s = s.replace(/\{\{Robux\|([^}]+)\}\}/g, '$1 Robux');
  // Generic {{Template|value}} -> value
  s = s.replace(/\{\{[^|}]+\|([^|}]+)[^}]*\}\}/g, '$1');
  // Remove remaining templates
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  // Wiki links: [[Link|Display]] -> Display, [[Link]] -> Link
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Bold/italic
  s = s.replace(/'{2,3}/g, '');
  // HTML
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<ref[^/]*\/>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  // Bullet/list markers
  s = s.replace(/^\*+\s*/gm, '');
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

// ---- Extract FishInfobox boundaries ----

function findInfoboxBounds(wikitext) {
  const start = wikitext.indexOf('{{FishInfobox');
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++;
      i++;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      i++;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return { start, end: wikitext.length };
}

// ---- Extract obtainment/source from FishInfobox ----

function extractInfoboxSource(wikitext) {
  const bounds = findInfoboxBounds(wikitext);
  if (!bounds) return null;

  const infobox = wikitext.slice(bounds.start, bounds.end);

  // Try obtainment first, then sources
  const obtainMatch = infobox.match(/\|\s*(?:obtainment|sources)\s*=\s*(.*)/i);
  if (!obtainMatch) return null;

  let val = obtainMatch[1].trim();
  // Clean wiki links
  val = val.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  val = val.replace(/\[\[([^\]]+)\]\]/g, '$1');
  val = val.replace(/\{\{[^}]*\}\}/g, '').trim();

  return val || null;
}

// ---- Find Navbox boundaries ----

function findNavboxBounds(wikitext) {
  const results = [];
  let searchFrom = 0;

  while (true) {
    const start = wikitext.indexOf('{{Navbox', searchFrom);
    if (start === -1) break;

    let depth = 0;
    for (let i = start; i < wikitext.length - 1; i++) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
        depth++;
        i++;
      } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
        depth--;
        i++;
        if (depth === 0) {
          results.push({ start, end: i + 1 });
          searchFrom = i + 1;
          break;
        }
      }
    }
    if (searchFrom <= start) break; // no closing found
  }

  return results;
}

// ---- Extract lore text ----

function extractLore(wikitext) {
  // Remove FishInfobox
  const infoBounds = findInfoboxBounds(wikitext);
  let text = wikitext;
  if (infoBounds) {
    text = text.slice(0, infoBounds.start) + text.slice(infoBounds.end);
  }

  // Remove Navboxes
  const navboxes = findNavboxBounds(text);
  for (let i = navboxes.length - 1; i >= 0; i--) {
    text = text.slice(0, navboxes[i].start) + text.slice(navboxes[i].end);
  }

  // Cut before == References == or == See also == or == Notes ==
  const refMatch = text.match(/\n==\s*(References|See [Aa]lso|Notes|External [Ll]inks)\s*==/);
  if (refMatch) {
    text = text.slice(0, refMatch.index);
  }

  // Remove section headings
  text = text.replace(/^==+\s*.*?==+\s*$/gm, '');

  // Remove category tags
  text = text.replace(/\[\[Category:[^\]]+\]\]/g, '');

  // Remove file/image embeds
  text = text.replace(/\[\[File:[^\]]+\]\]/gi, '');
  text = text.replace(/\[\[Image:[^\]]+\]\]/gi, '');

  // Clean wiki markup
  text = cleanWikitext(text);

  // Collapse multiple newlines
  text = text.replace(/\n{2,}/g, '\n').trim();

  if (!text || text.length < 10) return null;

  // Trim to 1-2 sentences (up to ~500 chars) for lore
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 2) {
    text = sentences.slice(0, 2).join('').trim();
  }

  return text;
}

// ---- Detect special mechanics ----

const MECHANIC_KEYWORDS = [
  { key: 'quest', pattern: /\bquest\b/i },
  { key: 'minigame', pattern: /\bminigame\b/i },
  { key: 'puzzle', pattern: /\bpuzzle\b/i },
  { key: 'cage', pattern: /\bcage\b/i },
  { key: 'net', pattern: /\bnet\b/i },
  { key: 'spear', pattern: /\bspear\b/i },
  { key: 'harpoon', pattern: /\bharpoon\b/i },
];

function detectMechanics(wikitext) {
  const found = [];
  for (const { key, pattern } of MECHANIC_KEYWORDS) {
    if (pattern.test(wikitext)) found.push(key);
  }
  return found.length > 0 ? found : null;
}

// ---- Slugify ----

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---- Process a single fish ----

async function processFish(name) {
  const title = name.replace(/ /g, '_');
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&maxlag=5`;

  const json = await fetchJson(url);

  // Page not found
  if (json.error) return null;

  const wikitext = json.parse?.wikitext?.['*'];
  if (!wikitext) return null;

  const lore = extractLore(wikitext);
  const wikiSource = extractInfoboxSource(wikitext);
  const mechanics = detectMechanics(wikitext);

  return { lore, wikiSource, mechanics };
}

// ---- Main ----

async function main() {
  console.log('Scraping wiki descriptions for fish\n');

  // Load fish list
  const fishFile = path.join(DATA_DIR, 'fish-merged.json');
  if (!fs.existsSync(fishFile)) {
    console.error('fish-merged.json not found. Run merge-data.js first.');
    process.exit(1);
  }

  const fish = JSON.parse(fs.readFileSync(fishFile, 'utf8'));
  console.log(`Fish to process: ${fish.length}`);

  // Load existing progress (resume support)
  let results = {};
  if (fs.existsSync(OUT_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      console.log(`Resuming: ${Object.keys(results).length} already scraped`);
    } catch {
      results = {};
    }
  }

  const stats = { found: 0, skipped: 0, errors: 0, cached: 0 };

  for (let i = 0; i < fish.length; i++) {
    const f = fish[i];
    const slug = f.id || slugify(f.name);

    // Skip already processed
    if (results[slug]) {
      stats.cached++;
      continue;
    }

    const label = `[${i + 1}/${fish.length}]`;
    process.stdout.write(`${label} ${f.name}...`);

    try {
      const data = await processFish(f.name);

      if (data && (data.lore || data.wikiSource || data.mechanics)) {
        results[slug] = data;
        stats.found++;
        console.log(' OK' + (data.lore ? ` (${data.lore.length} chars)` : ' (no lore)'));
      } else {
        results[slug] = { lore: null, wikiSource: null, mechanics: null };
        stats.skipped++;
        console.log(' no data');
      }
    } catch (err) {
      stats.errors++;
      console.log(` ERROR: ${err.message}`);
      results[slug] = { lore: null, wikiSource: null, mechanics: null };
    }

    // Save progress every N fish
    if ((i + 1) % SAVE_EVERY === 0) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
      process.stdout.write(`  [saved progress: ${Object.keys(results).length} entries]\n`);
    }

    // Rate limit
    await sleep(DELAY_MS);
  }

  // Final save
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));

  // Stats
  const withLore = Object.values(results).filter(r => r.lore).length;
  const withSource = Object.values(results).filter(r => r.wikiSource).length;
  const withMechanics = Object.values(results).filter(r => r.mechanics).length;

  console.log('\n========================================');
  console.log('Wiki descriptions scrape complete:');
  console.log(`  Total entries: ${Object.keys(results).length}`);
  console.log(`  With lore:     ${withLore}`);
  console.log(`  With source:   ${withSource}`);
  console.log(`  With mechanics: ${withMechanics}`);
  console.log(`  New found:     ${stats.found}`);
  console.log(`  Skipped:       ${stats.skipped}`);
  console.log(`  Errors:        ${stats.errors}`);
  console.log(`  Cached:        ${stats.cached}`);
  console.log(`\nSaved to ${OUT_FILE}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
