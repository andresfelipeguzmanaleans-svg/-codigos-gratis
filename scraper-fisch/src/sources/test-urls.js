const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fish = require('../../data/static/fish-list.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function test() {
  const samples = [
    fish.find(f => f.rarity === 'Common'),
    fish.find(f => f.rarity === 'Rare'),
    fish.find(f => f.rarity === 'Exotic'),
    fish.find(f => f.rarity === 'Trash'),
    fish.find(f => f.rarity === 'Legendary'),
  ];

  for (const f of samples) {
    const url = `https://fischcalculator.com/fish/${f.sourceId}/`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const heroLine = $('h1').parent().children('div').first().text().trim();
      console.log(`${f.sourceId} -> ${res.status} | ${heroLine.slice(0, 80)}`);
    } else {
      console.log(`${f.sourceId} -> ${res.status}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

test().catch(e => console.error(e));
