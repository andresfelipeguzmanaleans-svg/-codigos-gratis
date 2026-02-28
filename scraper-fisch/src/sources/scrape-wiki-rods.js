/**
 * Scrape rod descriptions & obtainment from fischipedia.org wiki.
 *
 * For each rod in rods.json, fetches its wiki page via MediaWiki API,
 * extracts narrative text and the obtainment field from the infobox.
 *
 * Output: scraper-fisch/data/static/wiki-rod-descriptions.json
 *
 * Rate limit: 1 request/second (~3 min for 166 rods).
 * Saves progress every 20 rods.
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
const OUT_FILE = path.join(DATA_DIR, 'wiki-rod-descriptions.json');
const MAX_RETRIES = 3;
const DELAY_MS = 1000;
const SAVE_EVERY = 20;

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

// ---- Wiki markup cleaning ----

function cleanWikitext(text) {
  if (!text) return '';
  let s = text;
  s = s.replace(/\{\{Item\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Rarity\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{C\$\|([^}]+)\}\}/g, (_, v) => `C$${v}`);
  s = s.replace(/\{\{Robux\|([^}]+)\}\}/g, '$1 Robux');
  s = s.replace(/\{\{Mutation\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{[^|}]+\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'{2,3}/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<ref[^/]*\/>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/^\*+\s*/gm, '- ');
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

// ---- Find infobox boundaries (generic) ----

function findInfoboxBounds(wikitext) {
  // Try various infobox templates
  const patterns = ['{{RodInfobox', '{{Infobox', '{{Rod', '{{ItemInfobox'];
  let startIdx = -1;

  for (const pat of patterns) {
    const idx = wikitext.indexOf(pat);
    if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
      startIdx = idx;
    }
  }

  if (startIdx === -1) return null;

  let depth = 0;
  for (let i = startIdx; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++; i++;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--; i++;
      if (depth === 0) return { start: startIdx, end: i + 1 };
    }
  }
  return { start: startIdx, end: wikitext.length };
}

// ---- Extract obtainment from infobox ----

function extractObtainment(wikitext) {
  const bounds = findInfoboxBounds(wikitext);
  if (!bounds) return null;

  const infobox = wikitext.slice(bounds.start, bounds.end);

  // Try obtained_from, obtainment, obtain, source, sources
  const match = infobox.match(/\|\s*(?:obtained_from|obtainment|obtain|source|sources)\s*=\s*([\s\S]*?)(?=\n\s*\||\n\s*\}\})/i);
  if (!match) return null;

  let val = cleanWikitext(match[1].trim());
  if (!val || val.length < 3) return null;

  return val;
}

// ---- Extract description (lore) ----

function extractDescription(wikitext) {
  const bounds = findInfoboxBounds(wikitext);
  let text = wikitext;
  if (bounds) {
    text = text.slice(0, bounds.start) + text.slice(bounds.end);
  }

  // Remove navboxes
  let navIdx;
  while ((navIdx = text.indexOf('{{Navbox')) !== -1) {
    let depth = 0;
    let end = navIdx;
    for (let i = navIdx; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
      else if (text[i] === '}' && text[i + 1] === '}') { depth--; i++; if (depth === 0) { end = i + 1; break; } }
    }
    text = text.slice(0, navIdx) + text.slice(end);
  }

  // Cut before References etc.
  const refMatch = text.match(/\n==\s*(References|See [Aa]lso|Notes|External|Trivia|Gallery)\s*==/);
  if (refMatch) text = text.slice(0, refMatch.index);

  // Remove section headings
  text = text.replace(/^==+\s*.*?==+\s*$/gm, '');
  // Remove categories
  text = text.replace(/\[\[Category:[^\]]+\]\]/g, '');
  // Remove file embeds
  text = text.replace(/\[\[File:[^\]]+\]\]/gi, '');
  text = text.replace(/\[\[Image:[^\]]+\]\]/gi, '');

  text = cleanWikitext(text);
  text = text.replace(/\n{2,}/g, '\n\n').trim();

  if (!text || text.length < 15) return null;

  // Take first 3-4 sentences max
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 4) {
    text = sentences.slice(0, 4).join('').trim();
  }

  return text;
}

// ---- Extract stats from infobox ----

function extractInfoboxStats(wikitext) {
  const bounds = findInfoboxBounds(wikitext);
  if (!bounds) return null;
  const infobox = wikitext.slice(bounds.start, bounds.end);

  const stats = {};
  const fields = [
    { key: 'obtainedFrom', pattern: /\|\s*obtained_from\s*=\s*(.+)/i },
    { key: 'price', pattern: /\|\s*price\s*=\s*(.+)/i },
    { key: 'stage', pattern: /\|\s*stage\s*=\s*(\d+)/i },
    { key: 'location', pattern: /\|\s*location\s*=\s*(.+)/i },
    { key: 'passive', pattern: /\|\s*passive\s*=\s*([\s\S]*?)(?=\n\s*\||\n\s*\}\})/i },
    { key: 'maxWeight', pattern: /\|\s*max_weight\s*=\s*([\d,]+)/i },
    { key: 'durability', pattern: /\|\s*durability\s*=\s*([\d,]+)/i },
  ];

  for (const { key, pattern } of fields) {
    const m = infobox.match(pattern);
    if (m) {
      let val = cleanWikitext(m[1].trim());
      if (val) stats[key] = val;
    }
  }

  return Object.keys(stats).length > 0 ? stats : null;
}

// ---- Process a single rod ----

async function processRod(name) {
  const title = name.replace(/ /g, '_');
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&maxlag=5`;

  const json = await fetchJson(url);
  if (json.error) return null;

  const wikitext = json.parse?.wikitext?.['*'];
  if (!wikitext) return null;

  const description = extractDescription(wikitext);
  const obtainment = extractObtainment(wikitext);
  const infoboxStats = extractInfoboxStats(wikitext);

  return { description, obtainment, infoboxStats };
}

// ---- Main ----

async function main() {
  console.log('Scraping wiki data for rods\n');

  const rodsFile = path.join(DATA_DIR, 'rods.json');
  if (!fs.existsSync(rodsFile)) {
    console.error('rods.json not found in data/static/');
    process.exit(1);
  }

  const rods = JSON.parse(fs.readFileSync(rodsFile, 'utf8'));
  console.log(`Rods to process: ${rods.length}`);

  // Load existing progress
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

  for (let i = 0; i < rods.length; i++) {
    const rod = rods[i];
    const slug = rod.id;

    if (results[slug]) {
      stats.cached++;
      continue;
    }

    const label = `[${i + 1}/${rods.length}]`;
    process.stdout.write(`${label} ${rod.name}...`);

    try {
      const data = await processRod(rod.name);

      if (data && (data.description || data.obtainment || data.infoboxStats)) {
        results[slug] = data;
        stats.found++;
        const parts = [];
        if (data.description) parts.push(`desc:${data.description.length}ch`);
        if (data.obtainment) parts.push('obtain');
        if (data.infoboxStats) parts.push(`stats:${Object.keys(data.infoboxStats).join(',')}`);
        console.log(` OK (${parts.join(', ')})`);
      } else {
        results[slug] = { description: null, obtainment: null, infoboxStats: null };
        stats.skipped++;
        console.log(' no data');
      }
    } catch (err) {
      stats.errors++;
      console.log(` ERROR: ${err.message}`);
      results[slug] = { description: null, obtainment: null, infoboxStats: null };
    }

    if ((i + 1) % SAVE_EVERY === 0) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
      process.stdout.write(`  [saved progress: ${Object.keys(results).length} entries]\n`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));

  const withDesc = Object.values(results).filter(r => r.description).length;
  const withObtain = Object.values(results).filter(r => r.obtainment).length;
  const withStats = Object.values(results).filter(r => r.infoboxStats).length;

  console.log('\n========================================');
  console.log('Wiki rod data scrape complete:');
  console.log(`  Total entries: ${Object.keys(results).length}`);
  console.log(`  With description: ${withDesc}`);
  console.log(`  With obtainment:  ${withObtain}`);
  console.log(`  With infobox stats: ${withStats}`);
  console.log(`  New found:  ${stats.found}`);
  console.log(`  Skipped:    ${stats.skipped}`);
  console.log(`  Errors:     ${stats.errors}`);
  console.log(`  Cached:     ${stats.cached}`);
  console.log(`\nSaved to ${OUT_FILE}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
