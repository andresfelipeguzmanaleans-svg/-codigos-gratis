const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fish = require('../../data/static/fish-list.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function test() {
  // Test first 30 fish
  let ok = 0, notFound = 0, noData = 0;
  const sample = fish.slice(0, 30);

  for (const f of sample) {
    const url = `https://fischcalculator.com/fish/${f.sourceId}/`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      notFound++;
      process.stdout.write('x');
    } else {
      const html = await res.text();
      const $ = cheerio.load(html);
      const heroLine = $('h1').parent().children('div').first().text().trim();
      if (heroLine && heroLine.includes('/kg')) {
        ok++;
        process.stdout.write('.');
      } else {
        noData++;
        process.stdout.write('?');
        console.log(`\n  ${f.sourceId} -> no hero data, h1: "${$('h1').text().trim().slice(0,50)}"`);
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n\nResultados de ${sample.length} peces:`);
  console.log(`  OK con datos: ${ok}`);
  console.log(`  200 sin datos: ${noData}`);
  console.log(`  404: ${notFound}`);
}

test().catch(e => console.error(e));
