const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fish = require('../../data/static/fish-list.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function test() {
  // Skip Special, test real fish from various rarities
  const realFish = fish.filter(f => f.rarity !== 'Special');
  const sample = realFish.slice(0, 40);

  let ok = 0, noData = 0, notFound = 0;
  const results = [];

  for (const f of sample) {
    const url = `https://fischcalculator.com/fish/${f.sourceId}/`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      notFound++;
      results.push(`  404: ${f.name} (${f.rarity})`);
    } else {
      const html = await res.text();
      const $ = cheerio.load(html);
      const heroLine = $('h1').parent().children('div').first().text().trim();
      if (heroLine && heroLine.includes('/kg')) {
        ok++;
      } else {
        noData++;
        results.push(`  noData: ${f.name} (${f.rarity})`);
      }
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n\n${sample.length} peces (no-Special):`);
  console.log(`  Con datos: ${ok}`);
  console.log(`  200 sin datos: ${noData}`);
  console.log(`  404: ${notFound}`);
  if (results.length > 0) {
    console.log('\nFallidos:');
    results.forEach(r => console.log(r));
  }
}

test().catch(e => console.error(e));
