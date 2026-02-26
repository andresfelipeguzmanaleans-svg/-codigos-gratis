const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_RETRIES = 3;

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
      const wait = 1000 * Math.pow(2, attempt - 1);
      process.stdout.write(` retry ${attempt}...`);
      await sleep(wait);
    }
  }
}

// ---- Extraction ----

/**
 * Extract mutations from the MutationHunter JS bundle.
 * The page is a Next.js app that loads mutation data in a JSON.parse() call
 * inside a webpack module (module ID 26551).
 */
async function extractMutationsFromBundle(html) {
  const $ = cheerio.load(html);

  // Find the JS bundle that contains the MutationHunter component
  // It's referenced in the RSC payload as module 26551 from specific chunks
  const scriptSrcs = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && src.includes('/_next/static/chunks/')) {
      scriptSrcs.push(src);
    }
  });

  // Also check inline scripts for RSC references to the MutationHunter module
  const bundleUrls = new Set();
  $('script').each((_, el) => {
    const text = $(el).html() || '';
    if (text.includes('MutationHunter')) {
      // Extract chunk filenames from the RSC payload
      const urlMatches = text.match(/\/_next\/static\/chunks\/[a-f0-9]+\.js/g);
      if (urlMatches) {
        urlMatches.forEach(u => bundleUrls.add(u));
      }
    }
  });

  // Add all script srcs as fallback
  scriptSrcs.forEach(s => bundleUrls.add(s));

  console.log(`Found ${bundleUrls.size} JS bundle URLs to check`);

  // Fetch each bundle and look for mutations JSON
  for (const bundlePath of bundleUrls) {
    const bundleUrl = `https://fischcalculator.com${bundlePath}`;
    process.stdout.write(`  Checking ${bundlePath.split('/').pop()}...`);

    const res = await fetchWithRetry(bundleUrl);
    if (!res.ok) {
      console.log(` ${res.status}`);
      continue;
    }

    const text = await res.text();

    // Strategy: find JSON.parse('[...multiplier...]') by locating the marker string
    // and then extracting the JSON between the single quotes.
    // We search for the pattern: e.v(JSON.parse(' followed by a [
    // and containing "multiplier", ending with ]'))
    const searchStr = "JSON.parse('[";
    let searchIdx = 0;

    while (true) {
      const idx = text.indexOf(searchStr, searchIdx);
      if (idx === -1) break;

      const jsonStart = idx + searchStr.length - 1; // start at [
      // Find the matching ]'))
      const jsonEnd = text.indexOf("]'))", jsonStart);
      if (jsonEnd === -1) {
        searchIdx = idx + searchStr.length;
        continue;
      }

      const candidate = text.slice(jsonStart, jsonEnd + 1);
      if (candidate.includes('"multiplier"')) {
        console.log(` FOUND mutations data! (${candidate.length} chars)`);

        // Unescape JS string escapes
        let jsonStr = candidate;
        jsonStr = jsonStr.replace(/\\'/g, "'");
        jsonStr = jsonStr.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        jsonStr = jsonStr.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );

        return JSON.parse(jsonStr);
      }

      searchIdx = idx + searchStr.length;
    }

    console.log(` no mutation data`);
  }

  return null;
}

// ---- Main ----

async function main() {
  console.log('Scraping mutations from fischcalculator.com/tools/mutation-hunter/\n');

  // Step 1: Fetch the mutation hunter page
  process.stdout.write('Fetching mutation hunter page...');
  const pageRes = await fetchWithRetry('https://fischcalculator.com/tools/mutation-hunter/');
  if (!pageRes.ok) {
    throw new Error(`Page returned HTTP ${pageRes.status}`);
  }
  const html = await pageRes.text();
  console.log(' OK');

  // Step 2: Extract mutations from JS bundles
  console.log('\nSearching JS bundles for mutation data...');
  const rawMutations = await extractMutationsFromBundle(html);

  if (!rawMutations || rawMutations.length === 0) {
    throw new Error('No mutation data found in any JS bundle');
  }

  console.log(`\nRaw mutations extracted: ${rawMutations.length}`);

  // Step 3: Clean and format
  const mutations = rawMutations.map((m, i) => ({
    id: m.id,
    name: m.displayName || m.name,
    multiplier: m.multiplier,
    category: m.category || 'unknown',
    obtainMethod: m.obtainMethod || null,
  }));

  // Sort by multiplier descending
  mutations.sort((a, b) => b.multiplier - a.multiplier);

  // Step 4: Save
  const outFile = path.join(__dirname, '..', '..', 'data', 'static', 'mutations.json');
  fs.writeFileSync(outFile, JSON.stringify(mutations, null, 2));

  // Step 5: Summary
  const cats = {};
  mutations.forEach(m => {
    if (!cats[m.category]) cats[m.category] = 0;
    cats[m.category]++;
  });

  console.log('\n========================================');
  console.log(`Total mutaciones: ${mutations.length}`);
  console.log(`Categorías:`);
  for (const [cat, count] of Object.entries(cats)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nTop 5 por multiplicador:`);
  mutations.slice(0, 5).forEach(m => {
    console.log(`  ${m.name}: ${m.multiplier}x [${m.category}]`);
  });
  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
