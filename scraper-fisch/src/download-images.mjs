/**
 * Download all fish images locally so Vercel serves them.
 * Saves to ../../public/images/fish/{id}.png
 * Updates fish-merged.json imageUrl to /images/fish/{id}.png
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'static', 'fish-merged.json');
const OUT_DIR = join(__dirname, '..', '..', 'public', 'images', 'fish');
const CONCURRENCY = 15;
const RETRY = 2;

async function downloadWithRetry(url, retries = RETRY) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FischGuide/1.0 (image-mirror)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function main() {
  const fish = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });

  const toDownload = fish.filter(f => f.imageUrl && f.id && f.imageUrl.startsWith('http'));
  console.log(`Found ${toDownload.length} fish with remote imageUrl`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
    const batch = toDownload.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (f) => {
      const ext = (f.imageUrl.split('.').pop() || 'png').toLowerCase();
      const filename = `${f.id}.${ext}`;
      const filepath = join(OUT_DIR, filename);

      // Skip if already downloaded and non-empty
      if (existsSync(filepath)) {
        try {
          const stat = statSync(filepath);
          if (stat.size > 100) {
            f.imageUrl = `/images/fish/${filename}`;
            skipped++;
            return;
          }
        } catch {}
      }

      try {
        const buffer = await downloadWithRetry(f.imageUrl);
        writeFileSync(filepath, buffer);
        f.imageUrl = `/images/fish/${filename}`;
        downloaded++;
      } catch (err) {
        console.error(`  FAIL: ${f.id} (${f.name}) - ${err.message}`);
        failed++;
      }
    }));

    const total = downloaded + skipped + failed;
    if (total % 100 < CONCURRENCY || i + CONCURRENCY >= toDownload.length) {
      console.log(`  ${total}/${toDownload.length} (${downloaded} new, ${skipped} cached, ${failed} failed)`);
    }
  }

  console.log(`\nDone: ${downloaded} downloaded, ${skipped} cached, ${failed} failed`);
  console.log(`Total images in ${OUT_DIR}: ${downloaded + skipped}`);

  // Write back
  writeFileSync(DATA_PATH, JSON.stringify(fish, null, 2));
  console.log('Updated fish-merged.json with local paths');
}

main().catch(err => { console.error(err); process.exit(1); });
