const fetch = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function inspect() {
  // Pick a known fish
  const slugs = ['great-white-shark', 'anglerfish', 'goldfish', 'electric-eel'];
  for (const slug of slugs) {
    const url = `https://fischcalculator.com/fish/${slug}/`;
    console.log(`\n=== ${url} ===`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    console.log('Status:', res.status);
    if (!res.ok) continue;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Look for images
    console.log('\nImages:');
    $('img').each((i, el) => {
      const src = $(el).attr('src') || '';
      const alt = $(el).attr('alt') || '';
      if (src.includes('fish') || src.includes('game') || alt) {
        console.log(`  src="${src.slice(0, 100)}" alt="${alt}"`);
      }
    });

    // Look for stat-like content: labels + values
    console.log('\nText blocks with numbers or labels:');
    $('dt, dd, th, td, .stat, [class*="stat"], [class*="detail"], [class*="info"]').each((i, el) => {
      const text = $(el).text().trim().slice(0, 80);
      if (text) console.log(`  <${el.tagName} class="${$(el).attr('class') || ''}"> ${text}`);
    });

    // Look for any key-value pairs in divs
    console.log('\nAll text content (first 3000 chars):');
    const bodyText = $('main, [class*="container"], [class*="content"]').first().text().replace(/\s+/g, ' ').trim();
    console.log(bodyText.slice(0, 3000));

    break; // just first one
  }
}

inspect().catch(e => console.error(e));
