const fetch = require('node-fetch');
const cheerio = require('cheerio');

async function inspect() {
  const res = await fetch('https://fischcalculator.com/tools/trade-calculator/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  // Check selects
  console.log('=== SELECT elements ===');
  $('select').each((i, el) => {
    const id = $(el).attr('id') || '';
    const name = $(el).attr('name') || '';
    const cls = $(el).attr('class') || '';
    const optgroups = $(el).find('optgroup').length;
    const options = $(el).find('option').length;
    console.log(`Select #${i}: id="${id}" name="${name}" class="${cls}" optgroups=${optgroups} options=${options}`);
  });

  // Check optgroups
  console.log('\n=== OPTGROUP labels ===');
  $('optgroup').each((i, el) => {
    const label = $(el).attr('label');
    const opts = $(el).find('option').length;
    console.log(`Optgroup: label="${label}" options=${opts}`);
  });

  // Show first 20 options with values
  console.log('\n=== First 20 options ===');
  $('select').first().find('option').slice(0, 20).each((i, el) => {
    const val = $(el).attr('value') || '';
    const text = $(el).text().trim();
    const parent = $(el).parent('optgroup').attr('label') || 'none';
    console.log(`  "${text}" value="${val}" group="${parent}"`);
  });

  // Check if it's client-rendered (React/Next)
  console.log('\n=== Script tags with data ===');
  $('script[id="__NEXT_DATA__"]').each((i, el) => {
    const json = $(el).html();
    console.log(`__NEXT_DATA__ found, length: ${json.length}`);
    const data = JSON.parse(json);
    const keys = Object.keys(data.props?.pageProps || {});
    console.log('pageProps keys:', keys);
  });
}

inspect().catch(e => console.error(e.message));
