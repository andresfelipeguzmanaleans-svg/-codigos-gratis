/**
 * Daily price history updater.
 *
 * Scrapes current values from game.guide/fisch-value-list and appends
 * today's snapshot to data/price-history.json.
 *
 * Safe to run multiple times per day — deduplicates by date.
 *
 * Can be run as a GitHub Actions cron job or locally.
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const OUTPUT = path.join(DATA_DIR, 'price-history.json');

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Reuse the tableItems extraction from the main scraper.
 */
function extractTableItems(html) {
  const $ = cheerio.load(html);
  let items = null;

  $('script').each((_, el) => {
    if (items) return;
    const text = $(el).html() || '';
    if (!text.includes('tableItems')) return;

    const marker = '\\"tableItems\\":[';
    let start = text.indexOf(marker);
    if (start === -1) {
      const alt = '"tableItems":[';
      start = text.indexOf(alt);
      if (start === -1) return;
      start += alt.length - 1;
    } else {
      start += marker.length - 1;
    }

    let depth = 0, end = -1;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '\\' && text[i + 1] === '"') { i++; continue; }
      if (text[i] === '[') depth++;
      if (text[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) return;

    try {
      let json = text.slice(start, end).replace(/\\"/g, '"').replace(/"\$D([^"]+)"/g, '"$1"');
      items = JSON.parse(json);
    } catch { /* ignore */ }
  });

  return items;
}

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  const date = today();
  console.log(`Updating price history for ${date}\n`);

  // Fetch current values
  const res = await fetch('https://www.game.guide/fisch-value-list', {
    headers: { 'User-Agent': UA },
    timeout: 30000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const tableItems = extractTableItems(html);
  if (!tableItems || tableItems.length === 0) {
    throw new Error('No tableItems found');
  }
  console.log(`Fetched ${tableItems.length} items from game.guide`);

  // Load existing history
  let history = {};
  if (fs.existsSync(OUTPUT)) {
    try { history = JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); } catch { /* fresh */ }
  }

  // Append today's values
  let added = 0;
  let updated = 0;

  for (const item of tableItems) {
    const slug = (item.slug || slugify(item.name)).replace(/-value-fisch$/, '');
    const value = parseFloat(String(item.value || '').replace(/,/g, ''));
    if (isNaN(value)) continue;

    if (!history[slug]) {
      history[slug] = [];
    }

    // Check if we already have an entry for today
    const existing = history[slug].find(h => h.date === date);
    if (existing) {
      if (existing.value !== Math.round(value)) {
        existing.value = Math.round(value);
        updated++;
      }
    } else {
      history[slug].push({ date, value: Math.round(value) });
      added++;
    }

    // Keep sorted by date
    history[slug].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Save
  fs.writeFileSync(OUTPUT, JSON.stringify(history, null, 2));

  const totalSlugs = Object.keys(history).length;
  console.log(`\nDone: ${added} new entries, ${updated} updated, ${totalSlugs} total items tracked`);
  console.log(`Saved to ${OUTPUT}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
