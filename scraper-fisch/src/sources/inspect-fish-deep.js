const fetch = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function inspect() {
  const url = 'https://fischcalculator.com/fish/great-white-shark/';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const $ = cheerio.load(html);

  // Find the hero/header area for rarity + location
  console.log('=== Elements near title ===');
  $('h1').each((i, el) => {
    console.log(`h1: "${$(el).text().trim()}"`);
    // Look at siblings and parent children
    $(el).parent().children().each((j, sib) => {
      const t = $(sib).text().trim().slice(0, 100);
      const cls = $(sib).attr('class') || '';
      if (t) console.log(`  sibling <${sib.tagName} class="${cls.slice(0,60)}"> "${t}"`);
    });
  });

  // Find "Base price" section content
  console.log('\n=== Value section inner HTML ===');
  $('h2').each((i, el) => {
    if ($(el).text().trim() === 'Value') {
      const section = $(el).parent();
      // Get all label-value pairs
      section.find('div').each((j, d) => {
        const text = $(d).clone().children('div').remove().end().text().trim();
        const cls = $(d).attr('class') || '';
        if (text && text.length < 80) {
          console.log(`  <div class="${cls.slice(0,60)}"> "${text}"`);
        }
      });
    }
  });

  // Find location in hero
  console.log('\n=== Location dots ===');
  $('a[href*="/location"]').each((i, el) => {
    console.log(`  href="${$(el).attr('href')}" text="${$(el).text().trim()}"`);
  });

  // Find bait mention
  console.log('\n=== Bait mentions ===');
  const bodyText = $('body').text();
  const baitMatch = bodyText.match(/(bait|Fish Head|Truffle|worm)[^.]{0,50}/gi);
  if (baitMatch) baitMatch.forEach(m => console.log(`  "${m.trim()}"`));

  // XP
  console.log('\n=== XP mentions ===');
  const xpMatch = bodyText.match(/\d+\s*xp|\bxp\s*\d+/gi);
  if (xpMatch) xpMatch.forEach(m => console.log(`  "${m}"`));
  else console.log('  No XP found');

  // Description / trivia
  console.log('\n=== Trivia/description ===');
  $('p').each((i, el) => {
    const t = $(el).text().trim();
    if (t.length > 30 && t.length < 300) {
      console.log(`  "${t}"`);
    }
  });

  // Also check a simpler fish
  console.log('\n\n=== SECOND FISH: goldfish ===');
  const res2 = await fetch('https://fischcalculator.com/fish/goldfish/', { headers: { 'User-Agent': UA } });
  const html2 = await res2.text();
  const $2 = cheerio.load(html2);

  // JSON-LD description
  $2('script[type="application/ld+json"]').first().each((i, el) => {
    const j = JSON.parse($2(el).html());
    console.log('JSON-LD description:', j.description);
  });

  // Value
  console.log('Value elements:');
  $2('*').each((i, el) => {
    const text = $2(el).clone().children().remove().end().text().trim();
    if (text && (text.includes('$/kg') || text.includes('-')) && /\d/.test(text) && text.length < 40) {
      console.log(`  "${text}"`);
    }
  });
}

inspect().catch(e => console.error(e));
