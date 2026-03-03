/**
 * Scrape individual item detail pages from game.guide for price history
 * and related items data.
 *
 * Reads the item list from data/trade-values.json and fetches each
 * /{slug}-value-fisch page. Extracts:
 *   - priceHistory: array of {date, value} from RSC payload
 *   - relatedItems: array of {name, slug, value} from RSC payload
 *
 * Output: data/trade-details.json
 *
 * Uses incremental save — safe to interrupt and resume.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const INPUT = path.join(DATA_DIR, 'trade-values.json');
const OUTPUT = path.join(DATA_DIR, 'trade-details.json');

const DELAY_MS = 1200; // throttle between requests
const BATCH_SAVE = 20; // save progress every N items

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Extract price history from RSC payload.
 * Format in RSC: "price":"800.00","recordedAt":"2025-12-01T00:09:44.000Z","valueField":"value"
 */
function extractPriceHistory($) {
  const history = [];

  $('script').each((_, el) => {
    const text = $(el).html() || '';
    if (!text.includes('recordedAt')) return;

    // Match all price history entries — handle both escaped and unescaped quotes
    const raw = text.replace(/\\"/g, '"');
    const regex = /"price"\s*:\s*"([^"]+?)"\s*,\s*"recordedAt"\s*:\s*"([^"]+?)"/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
      const value = parseFloat(m[1]);
      const dateStr = m[2];
      if (!isNaN(value) && dateStr) {
        history.push({
          date: dateStr.slice(0, 10), // YYYY-MM-DD
          value: Math.round(value),
        });
      }
    }
  });

  // Deduplicate by date, keep latest
  const byDate = new Map();
  history.forEach(h => byDate.set(h.date, h.value));
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Extract related items from RSC payload.
 * These appear in a section called "Related Values" or similar,
 * as small card objects with name, slug, value.
 */
function extractRelatedItems($, currentSlug) {
  const items = [];

  $('script').each((_, el) => {
    const text = $(el).html() || '';
    // Related items have slug patterns ending in -value-fisch
    if (!text.includes('-value-fisch')) return;

    const raw = text.replace(/\\"/g, '"');

    // Look for item objects: {"name":"...","slug":"...-value-fisch","value":"..."}
    // or variations with different field orders
    const regex = /"name"\s*:\s*"([^"]+?)"\s*,\s*"slug"\s*:\s*"([^"]+?-value-fisch)"\s*,\s*"value"\s*:\s*"?(\d+)"?/g;
    let m;
    while ((m = regex.exec(raw)) !== null) {
      const slug = m[2].replace(/-value-fisch$/, '');
      if (slug === currentSlug) continue; // skip self
      const value = parseInt(m[3], 10);
      if (!isNaN(value)) {
        items.push({ name: m[1], slug, value });
      }
    }
  });

  // Deduplicate by slug
  const seen = new Set();
  return items.filter(i => {
    if (seen.has(i.slug)) return false;
    seen.add(i.slug);
    return true;
  });
}

async function scrapeDetail(slug) {
  const url = `https://www.game.guide/${slug}-value-fisch`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    timeout: 30000,
  });

  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const priceHistory = extractPriceHistory($);
  const relatedItems = extractRelatedItems($, slug);

  return { priceHistory, relatedItems };
}

async function main() {
  console.log('Scraping individual item details from game.guide\n');

  // Load item list
  const tradeValues = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const allItems = tradeValues.items;
  console.log(`Loaded ${allItems.length} items from trade-values.json`);

  // Load existing progress (if any)
  let existing = {};
  if (fs.existsSync(OUTPUT)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')).items || {};
      console.log(`Resuming: ${Object.keys(existing).length} items already scraped`);
    } catch (e) {
      console.log('Could not read existing progress, starting fresh');
    }
  }

  const results = { ...existing };
  let scraped = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const slug = item.slug;

    // Skip if already scraped
    if (results[slug] && !results[slug].error) {
      skipped++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${allItems.length}] ${item.name}... `);

    try {
      const detail = await scrapeDetail(slug);

      if (detail.error) {
        console.log(`ERROR: ${detail.error}`);
        results[slug] = { error: detail.error };
        errors++;
      } else {
        console.log(`OK (${detail.priceHistory.length} history, ${detail.relatedItems.length} related)`);
        results[slug] = {
          priceHistory: detail.priceHistory,
          relatedItems: detail.relatedItems,
        };
      }
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      results[slug] = { error: err.message };
      errors++;
    }

    scraped++;

    // Save progress periodically
    if (scraped % BATCH_SAVE === 0) {
      saveOutput(results);
      console.log(`  [saved progress: ${Object.keys(results).length} items]`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  saveOutput(results);

  // Stats
  const total = Object.keys(results).length;
  const withHistory = Object.values(results).filter(r => r.priceHistory && r.priceHistory.length > 0).length;
  const withRelated = Object.values(results).filter(r => r.relatedItems && r.relatedItems.length > 0).length;
  const withErrors = Object.values(results).filter(r => r.error).length;

  console.log('\n========================================');
  console.log(`Total items processed: ${total}`);
  console.log(`  Scraped this run: ${scraped}`);
  console.log(`  Skipped (cached): ${skipped}`);
  console.log(`  With price history: ${withHistory}`);
  console.log(`  With related items: ${withRelated}`);
  console.log(`  With errors: ${withErrors}`);
  console.log(`\nSaved to ${OUTPUT}`);
}

function saveOutput(results) {
  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'game.guide (individual pages)',
    totalItems: Object.keys(results).length,
    items: results,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
