/**
 * Scrape trade values from game.guide/fisch-value-list
 *
 * The page embeds full item data in React Server Components (RSC) payload
 * inside self.__next_f.push() script tags.
 *
 * Two data sources in the RSC payload:
 *  - "tableItems" array: name, slug, value, rarity, demand, trend, imageUrl
 *  - Full items array: adds itemType (boat/rod_skin), stock, sold, cost
 *
 * Output: data/trade-values.json
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseValue(str) {
  if (!str) return null;
  str = String(str).trim().replace(/,/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

/**
 * Extract the tableItems array from the RSC payload.
 * The data uses \" escaped quotes inside a JS string literal.
 */
function extractTableItems(html, $) {
  let items = null;

  $('script').each((_, el) => {
    if (items) return;
    const text = $(el).html() || '';
    if (!text.includes('tableItems')) return;

    // The marker uses escaped quotes: \"tableItems\":[
    const marker = '\\"tableItems\\":[';
    let start = text.indexOf(marker);

    // Fallback: try unescaped version
    if (start === -1) {
      const altMarker = '"tableItems":[';
      start = text.indexOf(altMarker);
      if (start === -1) return;
      start += altMarker.length - 1;
    } else {
      start += marker.length - 1;
    }

    // Find matching ] — track depth, skip escaped chars
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\' && text[i + 1] === '"') { i++; continue; }
      if (ch === '[') depth++;
      if (ch === ']') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }

    if (end === -1) return;

    try {
      let jsonStr = text.slice(start, end);
      // Unescape \" to " for valid JSON
      jsonStr = jsonStr.replace(/\\"/g, '"');
      // Handle $D date prefixes — convert to plain strings
      jsonStr = jsonStr.replace(/"\$D([^"]+)"/g, '"$1"');
      items = JSON.parse(jsonStr);
    } catch (err) {
      console.error('Failed to parse tableItems:', err.message);
    }
  });

  return items;
}

/**
 * Extract the full items array with itemType from the RSC payload.
 * Each item has: slug, name, value, demand, stability, stock, sold, cost,
 *                rarity, itemType (boat/rod_skin), imageUrl
 * Data uses \" escaped quotes.
 */
function extractFullItems(html, $) {
  const itemMap = new Map(); // slug -> item data

  $('script').each((_, el) => {
    const text = $(el).html() || '';
    // The full items are in the script with many "itemType" occurrences
    if ((text.match(/itemType/g) || []).length < 10) return;

    // Extract individual item objects with regex
    // The data uses escaped quotes: \"slug\":\"x-value-fisch\",...,\"itemType\":\"rod_skin\"
    const regex = /\\"slug\\":\\"([^\\]+?-value-fisch)\\"[^}]*?\\"name\\":\\"([^\\]+?)\\"[^}]*?\\"itemType\\":\\"([^\\]+?)\\"/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const slug = match[1];
      const name = match[2];
      const itemType = match[3];

      // Extract a broader context to get other fields
      const blockStart = Math.max(0, match.index - 50);
      const blockEnd = Math.min(text.length, match.index + match[0].length + 200);
      const block = text.slice(blockStart, blockEnd);

      const getValue = (field) => {
        const m = block.match(new RegExp(`\\\\"${field}\\\\":\\\\"([^\\\\]*?)\\\\"`));
        return m ? m[1] : null;
      };

      if (!itemMap.has(slug)) {
        itemMap.set(slug, {
          name,
          slug,
          itemType,
          stability: getValue('stability'),
          stock: getValue('stock'),
          sold: getValue('sold'),
          cost: getValue('cost'),
        });
      }
    }
  });

  return itemMap;
}

async function main() {
  console.log('Scraping trade values from game.guide/fisch-value-list\n');

  const res = await fetch('https://www.game.guide/fisch-value-list', {
    headers: { 'User-Agent': UA },
    timeout: 30000,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`Page fetched (${(html.length / 1024).toFixed(0)} KB)`);

  const $ = cheerio.load(html);

  // Strategy 1: Extract from RSC "tableItems" (cleanest structured data)
  console.log('\nExtracting from RSC tableItems...');
  const tableItems = extractTableItems(html, $);

  if (!tableItems || tableItems.length === 0) {
    throw new Error('No tableItems found in RSC payload');
  }
  console.log(`Found ${tableItems.length} items in tableItems`);

  // Strategy 2: Extract itemType from full RSC data
  console.log('Extracting itemType from RSC full data...');
  const fullItemMap = extractFullItems(html, $);
  console.log(`Found ${fullItemMap.size} items with itemType`);

  // Merge: tableItems + full item data
  const items = tableItems.map(t => {
    const slug = t.slug || slugify(t.name) + '-value-fisch';
    const full = fullItemMap.get(slug);
    const demand = t.demand && t.demand !== '-' && t.demand !== 'N/A' ? t.demand : null;
    const trend = t.trend && t.trend !== '-' && t.trend !== 'N/A' ? t.trend : null;

    // Build clean image URL
    let imageUrl = null;
    if (t.imageUrl) {
      const img = t.imageUrl.replace(/^\/cdn-cgi\/image\/[^/]+\//, '/');
      imageUrl = img.startsWith('http') ? img : 'https://www.game.guide' + img;
    }

    return {
      name: t.name,
      slug: slug.replace(/-value-fisch$/, ''),
      tradeValue: parseValue(t.value),
      demand,
      trend,
      rarity: t.rarity || null,
      itemType: full ? full.itemType : null,
      stock: full ? full.stock : null,
      sold: full ? full.sold : null,
      cost: full ? parseValue(full.cost) : null,
      imageUrl,
      detailUrl: `https://www.game.guide/${slug}`,
    };
  });

  // Deduplicate by slug
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (seen.has(item.slug)) continue;
    seen.add(item.slug);
    unique.push(item);
  }

  // Sort by tradeValue descending
  unique.sort((a, b) => (b.tradeValue || 0) - (a.tradeValue || 0));

  // Stats
  const withValue = unique.filter(i => i.tradeValue !== null);
  const withDemand = unique.filter(i => i.demand !== null);
  const withTrend = unique.filter(i => i.trend !== null);
  const withImage = unique.filter(i => i.imageUrl !== null);
  const withType = unique.filter(i => i.itemType !== null);

  // Item type distribution
  const typeDist = {};
  unique.forEach(i => {
    const t = i.itemType || 'unknown';
    typeDist[t] = (typeDist[t] || 0) + 1;
  });

  // Rarity distribution
  const rarDist = {};
  unique.forEach(i => {
    const r = i.rarity || 'unknown';
    rarDist[r] = (rarDist[r] || 0) + 1;
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    source: 'game.guide',
    totalItems: unique.length,
    items: unique,
  };

  const outFile = path.join(__dirname, '..', '..', 'data', 'trade-values.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log('\n========================================');
  console.log(`Total items: ${unique.length}`);
  console.log(`  With trade value: ${withValue.length}`);
  console.log(`  With demand:      ${withDemand.length}`);
  console.log(`  With trend:       ${withTrend.length}`);
  console.log(`  With image:       ${withImage.length}`);
  console.log(`  With itemType:    ${withType.length}`);

  console.log('\nItem type distribution:');
  Object.entries(typeDist).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => {
    console.log(`  ${t}: ${c}`);
  });

  console.log('\nRarity (source) distribution:');
  Object.entries(rarDist).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => {
    console.log(`  ${r}: ${c}`);
  });

  console.log('\nTop 10 by value:');
  unique.slice(0, 10).forEach(i => {
    console.log(`  ${i.name} (${i.itemType}): ${i.tradeValue} ER, demand=${i.demand}, trend=${i.trend}`);
  });

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
