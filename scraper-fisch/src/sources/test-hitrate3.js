const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fish = require('../../data/static/fish-list.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function test() {
  // Test 3 fish from each non-Special, non-Limited rarity
  const skip = new Set(['Special', 'Limited']);
  const byRarity = {};
  fish.forEach(f => {
    if (skip.has(f.rarity)) return;
    if (!byRarity[f.rarity]) byRarity[f.rarity] = [];
    byRarity[f.rarity].push(f);
  });

  for (const [rarity, list] of Object.entries(byRarity)) {
    const sample = list.slice(0, 3);
    const results = [];
    for (const f of sample) {
      const url = `https://fischcalculator.com/fish/${f.sourceId}/`;
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const html = await res.text();
      const $ = cheerio.load(html);
      const heroLine = $('h1').parent().children('div').first().text().trim();
      const hasData = heroLine && heroLine.includes('/kg');
      results.push(hasData ? 'OK' : 'NO');
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`${rarity} (${list.length}): ${results.join(', ')}`);
  }
}

test().catch(e => console.error(e));
