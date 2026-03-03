const fs = require('fs');
const path = require('path');
const https = require('https');

const RODS = require('../src/data/games/fisch/rods.json');
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'rods');
const API = 'https://fischipedia.org/w/api.php';
const BATCH = 50; // MediaWiki allows up to 50 titles per query
const DELAY = 600;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u, redirects) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : require('http');
      mod.get(u, { headers: { 'User-Agent': 'FischDataBot/1.0' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const stream = fs.createWriteStream(dest);
        res.pipe(stream);
        stream.on('finish', () => { stream.close(); resolve(); });
        stream.on('error', reject);
      }).on('error', reject);
    };
    follow(url, 0);
  });
}

async function fetchBatch(titles) {
  const url = `${API}?action=query&titles=${titles.map(t => encodeURIComponent(t)).join('|')}&prop=imageinfo&iiprop=url&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'FischDataBot/1.0' } });
  const json = await res.json();
  const results = {};
  for (const page of Object.values(json.query.pages)) {
    if (page.imageinfo && page.imageinfo[0]) {
      // Extract the original file title without "File:" prefix
      const name = page.title.replace(/^File:/, '').replace(/\.png$/i, '');
      results[name] = page.imageinfo[0].url;
      // Also store with underscores for lookup
      results[name.replace(/ /g, '_')] = page.imageinfo[0].url;
    }
  }
  return results;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // Build list of file titles to query
  const rodFiles = RODS.map(r => ({
    id: r.id,
    name: r.name,
    fileTitle: `File:${r.name.replace(/ /g, '_')}.png`,
  }));

  console.log(`Querying fischipedia for ${rodFiles.length} rod images...\n`);

  // Query in batches
  const urlMap = {};
  for (let i = 0; i < rodFiles.length; i += BATCH) {
    const batch = rodFiles.slice(i, i + BATCH);
    const titles = batch.map(r => r.fileTitle);
    process.stdout.write(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(rodFiles.length / BATCH)}...`);
    try {
      const results = await fetchBatch(titles);
      Object.assign(urlMap, results);
      console.log(` ${Object.keys(results).length} found`);
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
    if (i + BATCH < rodFiles.length) await sleep(DELAY);
  }

  console.log(`\nFound URLs for ${Object.keys(urlMap).length}/${rodFiles.length} rods`);

  // Download images
  let downloaded = 0, skipped = 0, failed = 0;

  for (const rod of rodFiles) {
    const dest = path.join(OUT_DIR, `${rod.id}.png`);
    if (fs.existsSync(dest)) { skipped++; continue; }

    // Try both with underscores and spaces since wiki API may return either
    const url = urlMap[rod.name.replace(/ /g, '_')] || urlMap[rod.name];
    if (!url) { continue; }

    try {
      await download(url, dest);
      downloaded++;
      if (downloaded % 20 === 0) console.log(`  Downloaded ${downloaded}...`);
      await sleep(200);
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${rod.name} - ${err.message}`);
      // Clean up partial file
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }
  }

  // Summary
  const existing = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).length;
  console.log(`\n========================================`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Not found on wiki: ${rodFiles.length - Object.keys(urlMap).length}`);
  console.log(`Total images in ${OUT_DIR}: ${existing}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
