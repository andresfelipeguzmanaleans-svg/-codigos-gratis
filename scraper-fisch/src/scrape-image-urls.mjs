/**
 * Scrapes real image URLs from Fischipedia wiki API for all fish.
 * MediaWiki stores images at hash-based paths, so we can't construct URLs
 * from filenames alone — we must query the API.
 *
 * Writes the result back into fish-merged.json (updates imageUrl field).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FISH_PATH = path.join(__dirname, '..', 'data', 'static', 'fish-merged.json');
const API = 'https://fischipedia.org/w/api.php';
const BATCH = 50; // MediaWiki allows up to 50 titles per query

async function fetchImageUrls(filenames) {
  const titles = filenames.map(f => 'File:' + f).join('|');
  const url = `${API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const json = await res.json();
  const map = {};
  const pages = json.query?.pages || {};
  for (const page of Object.values(pages)) {
    if (page.imageinfo && page.imageinfo[0]?.url) {
      // Extract original filename from title "File:Name.png" -> "Name.png"
      const fname = page.title.replace('File:', '');
      map[fname] = page.imageinfo[0].url;
    }
  }
  return map;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FISH_PATH, 'utf8'));

  // Collect unique non-empty image filenames
  const filenames = [...new Set(
    data
      .filter(f => f.image && f.image !== '.png')
      .map(f => f.image)
  )];

  console.log(`Found ${filenames.length} unique image filenames to resolve`);

  // Batch query
  const allUrls = {};
  for (let i = 0; i < filenames.length; i += BATCH) {
    const batch = filenames.slice(i, i + BATCH);
    process.stdout.write(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(filenames.length / BATCH)}...`);
    const urls = await fetchImageUrls(batch);
    Object.assign(allUrls, urls);
    console.log(` got ${Object.keys(urls).length} URLs`);
    // Small delay to be polite
    if (i + BATCH < filenames.length) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResolved ${Object.keys(allUrls).length} of ${filenames.length} images`);

  // Update fish data
  let updated = 0;
  for (const fish of data) {
    if (fish.image && allUrls[fish.image]) {
      fish.imageUrl = allUrls[fish.image];
      updated++;
    }
  }

  fs.writeFileSync(FISH_PATH, JSON.stringify(data, null, 2));
  console.log(`Updated ${updated} fish with imageUrl in fish-merged.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
