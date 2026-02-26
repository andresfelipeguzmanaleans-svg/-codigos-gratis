const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const fishList = require('../../data/static/fish-list.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DELAY_MS = 500;
const MAX_RETRIES = 3;
const SCRAPEABLE = new Set(['Apex', 'Secret', 'Exotic', 'Mythical', 'Legendary']);

// ---- Utils ----

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      process.stdout.write(` retry ${attempt}...`);
      await sleep(wait);
    }
  }
}

function parseNum(str) {
  if (!str) return null;
  const clean = str.replace(/[,$]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// ---- Parser ----

function parseFishPage(html) {
  const $ = cheerio.load(html);

  // Check if it's a real fish page (not the generic database page)
  const h1 = $('h1').text().trim();
  if (!h1 || h1.includes('Fish Database')) return null;

  const data = {};

  // Hero line: "Mythical$12000/kg•The Ocean"
  const heroLine = $('h1').parent().children('div').first().text().trim();

  // Rarity: first word before $
  const rarityMatch = heroLine.match(/^([A-Za-z]+)/);
  if (rarityMatch) data.rarity = rarityMatch[1];

  // Base value: $X/kg
  const valueMatch = heroLine.match(/\$([\d,.]+)\/kg/);
  if (valueMatch) data.baseValue = parseNum(valueMatch[1]);

  // Location: after the bullet •
  const locMatch = heroLine.match(/•\s*(.+)/);
  if (locMatch) data.location = locMatch[1].trim();

  // Grid stats: Where, When, Weather, Min Luck
  $('dt').each((_, el) => {
    const label = $(el).text().trim().toLowerCase();
    const value = $(el).next('dd').text().trim();
    if (label === 'time') data.time = value;
    if (label === 'weather') data.weather = value;
  });

  // Min Luck from hero grid
  const gridText = $('h1').parent().children().eq(2).text();
  const luckMatch = gridText.match(/Min Luck\s*([\d]+)%/);
  if (luckMatch) data.minLuck = parseInt(luckMatch[1]);

  // Where from grid
  const whereMatch = gridText.match(/Where\s*([A-Z][^W]*?)(?:When|$)/);
  if (whereMatch && !data.location) data.location = whereMatch[1].trim();

  // Value section: base price, weight range, average catch
  $('h2').each((_, el) => {
    if ($(el).text().trim() !== 'Value') return;
    const section = $(el).parent();

    const labels = [];
    section.find('.text-sm.text-slate-300, .text-slate-300').each((_, l) => {
      labels.push($(l).text().trim().toLowerCase());
    });

    const values = [];
    section.find('.text-xl').each((_, v) => {
      values.push($(v).text().trim());
    });

    labels.forEach((label, i) => {
      const val = values[i] || '';
      if (label.includes('base price') && !data.baseValue) {
        data.baseValue = parseNum(val.replace('/kg', ''));
      }
      if (label.includes('weight range')) {
        const wMatch = val.match(/([\d,.]+)\s*-\s*([\d,.]+)/);
        if (wMatch) {
          data.weightRange = { min: parseNum(wMatch[1]), max: parseNum(wMatch[2]) };
          // Estimate base weight as average
          data.baseWeight = Math.round((data.weightRange.min + data.weightRange.max) / 2 * 10) / 10;
        }
      }
    });
  });

  // Description: from trivia box
  const triviaBox = $('h1').parent().children().eq(3);
  const triviaText = triviaBox.find('p, span').filter((_, el) => {
    const t = $(el).text().trim();
    return t.length > 30 && !t.includes('Has trivia') && !t.includes('Hard');
  }).first().text().trim();
  if (triviaText) data.description = triviaText;

  // Bait: from strategy section
  const bodyText = $('body').text();
  const baitMatch = bodyText.match(/(?:Use|use|with)\s+([A-Z][A-Za-z\s]+?)\s+bait/);
  if (baitMatch) data.bait = baitMatch[1].trim();

  // Image: check JSON-LD or og:image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) data.imageUrl = ogImage;

  return data;
}

// ---- Main ----

async function main() {
  const scrapeable = fishList.filter(f => SCRAPEABLE.has(f.rarity));
  const skipped = fishList.filter(f => !SCRAPEABLE.has(f.rarity));

  console.log(`Total peces: ${fishList.length}`);
  console.log(`Con página (${[...SCRAPEABLE].join(', ')}): ${scrapeable.length}`);
  console.log(`Sin página (se incluyen con datos básicos): ${skipped.length}`);
  console.log(`\nIniciando scraping...\n`);

  const results = [];
  const errors = [];
  let scraped = 0;

  // Add skipped fish with basic data
  for (const f of skipped) {
    results.push({
      id: f.id,
      name: f.name,
      rarity: f.rarity,
      baseValue: null,
      baseWeight: null,
      weightRange: null,
      location: null,
      bait: null,
      xp: null,
      description: null,
      imageUrl: null,
      source: 'fischcalculator.com',
    });
  }

  // Scrape fish with pages
  for (let i = 0; i < scrapeable.length; i++) {
    const f = scrapeable[i];
    const url = `https://fischcalculator.com/fish/${f.sourceId}/`;
    const label = `[${i + 1}/${scrapeable.length}]`;

    process.stdout.write(`${label} Scraping ${f.name}...`);

    try {
      const res = await fetchWithRetry(url);

      if (!res.ok) {
        console.log(` ${res.status} SKIP`);
        errors.push({ name: f.name, sourceId: f.sourceId, error: `HTTP ${res.status}` });
        results.push({
          id: f.id, name: f.name, rarity: f.rarity,
          baseValue: null, baseWeight: null, weightRange: null,
          location: null, bait: null, xp: null, description: null, imageUrl: null,
          source: 'fischcalculator.com',
        });
      } else {
        const html = await res.text();
        const parsed = parseFishPage(html);

        if (!parsed) {
          console.log(' NO DATA');
          errors.push({ name: f.name, sourceId: f.sourceId, error: 'No fish data on page' });
          results.push({
            id: f.id, name: f.name, rarity: f.rarity,
            baseValue: null, baseWeight: null, weightRange: null,
            location: null, bait: null, xp: null, description: null, imageUrl: null,
            source: 'fischcalculator.com',
          });
        } else {
          scraped++;
          console.log(` OK (${parsed.baseValue ? '$' + parsed.baseValue + '/kg' : 'no value'})`);
          results.push({
            id: f.id,
            name: f.name,
            rarity: parsed.rarity || f.rarity,
            baseValue: parsed.baseValue || null,
            baseWeight: parsed.baseWeight || null,
            weightRange: parsed.weightRange || null,
            location: parsed.location || null,
            bait: parsed.bait || null,
            xp: null, // not available on pages
            description: parsed.description || null,
            imageUrl: parsed.imageUrl || null,
            source: 'fischcalculator.com',
          });
        }
      }
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      errors.push({ name: f.name, sourceId: f.sourceId, error: err.message });
      results.push({
        id: f.id, name: f.name, rarity: f.rarity,
        baseValue: null, baseWeight: null, weightRange: null,
        location: null, bait: null, xp: null, description: null, imageUrl: null,
        source: 'fischcalculator.com',
      });
    }

    await sleep(DELAY_MS);
  }

  // Sort by name
  results.sort((a, b) => a.name.localeCompare(b.name));

  // Save
  const outFile = path.join(__dirname, '..', '..', 'data', 'static', 'fish-complete.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));

  // Summary
  console.log('\n========================================');
  console.log(`Total en fish-complete.json: ${results.length}`);
  console.log(`Scrapeados con datos: ${scraped}`);
  console.log(`Sin página (datos básicos): ${skipped.length}`);
  console.log(`Errores: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nPeces que fallaron:');
    errors.forEach(e => console.log(`  - ${e.name} (${e.sourceId}): ${e.error}`));
  }

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
