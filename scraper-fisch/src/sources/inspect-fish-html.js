const fetch = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function inspect() {
  const url = 'https://fischcalculator.com/fish/great-white-shark/';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const $ = cheerio.load(html);

  // Dump all dt/dd pairs
  console.log('=== DT/DD pairs ===');
  $('dt').each((i, el) => {
    const label = $(el).text().trim();
    const value = $(el).next('dd').text().trim();
    console.log(`  ${label}: ${value}`);
  });

  // JSON-LD
  console.log('\n=== JSON-LD ===');
  $('script[type="application/ld+json"]').each((i, el) => {
    const j = JSON.parse($(el).html());
    console.log(JSON.stringify(j, null, 2).slice(0, 500));
  });

  // Find value/weight info
  console.log('\n=== All text with $ or kg ===');
  $('*').each((i, el) => {
    const text = $(el).clone().children().remove().end().text().trim();
    if (text && (text.includes('$') || text.includes('kg')) && text.length < 60) {
      const cls = $(el).attr('class') || '';
      console.log(`  <${el.tagName} class="${cls.slice(0,50)}"> "${text}"`);
    }
  });

  // Find rarity badge
  console.log('\n=== Rarity/badge elements ===');
  $('[class*="rarity"], [class*="badge"], [class*="tag"], [class*="pill"]').each((i, el) => {
    console.log(`  <${el.tagName} class="${$(el).attr('class')}"> "${$(el).text().trim()}"`);
  });

  // Fish image
  console.log('\n=== All img srcs ===');
  $('img').each((i, el) => {
    console.log(`  src="${$(el).attr('src')}" alt="${$(el).attr('alt') || ''}"`);
  });

  // Background images in style attrs
  console.log('\n=== Background images ===');
  $('[style*="background"]').each((i, el) => {
    const style = $(el).attr('style');
    console.log(`  ${style.slice(0, 150)}`);
  });

  // Find the value section specifically
  console.log('\n=== Sections with "Value" or "Weight" heading ===');
  $('h2, h3, h4').each((i, el) => {
    const text = $(el).text().trim();
    if (/value|weight|location|spawn|bait/i.test(text)) {
      console.log(`\n  <${el.tagName}> "${text}"`);
      // Get next sibling content
      const next = $(el).nextAll().slice(0, 3);
      next.each((j, sib) => {
        console.log(`    -> "${$(sib).text().trim().slice(0, 100)}"`);
      });
    }
  });
}

inspect().catch(e => console.error(e));
