/**
 * Download rod skin & boat images from game.guide locally.
 * Saves to ../../public/images/rod-skins/{slug}.png and ../../public/images/boats/{slug}.png
 * Updates rod-skins.json and boats.json imageUrl to local paths.
 *
 * game.guide uses Cloudflare hotlink protection — Referer header is required.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASTRO_DATA = join(__dirname, '..', '..', 'src', 'data', 'games', 'fisch');
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'images');
const CONCURRENCY = 10;
const RETRY = 2;

const CATEGORIES = [
  {
    name: 'rod-skins',
    dataFile: join(ASTRO_DATA, 'rod-skins.json'),
    outDir: join(PUBLIC_DIR, 'rod-skins'),
    localPrefix: '/images/rod-skins',
  },
  {
    name: 'boats',
    dataFile: join(ASTRO_DATA, 'boats.json'),
    outDir: join(PUBLIC_DIR, 'boats'),
    localPrefix: '/images/boats',
  },
];

async function downloadWithRetry(url, retries = RETRY) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.game.guide/fisch-value-list',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function processCategory(cat) {
  console.log(`\n=== ${cat.name} ===`);
  const items = JSON.parse(readFileSync(cat.dataFile, 'utf8'));
  mkdirSync(cat.outDir, { recursive: true });

  const toDownload = items.filter(i => i.imageUrl && i.slug && i.imageUrl.startsWith('http'));
  console.log(`Found ${toDownload.length}/${items.length} with remote imageUrl`);

  let downloaded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < toDownload.length; i += CONCURRENCY) {
    const batch = toDownload.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      const ext = (item.imageUrl.split('.').pop() || 'png').split('?')[0].toLowerCase();
      const filename = `${item.slug}.${ext}`;
      const filepath = join(cat.outDir, filename);

      // Skip if already downloaded and non-empty
      if (existsSync(filepath)) {
        try {
          const stat = statSync(filepath);
          if (stat.size > 100) {
            item.imageUrl = `${cat.localPrefix}/${filename}`;
            skipped++;
            return;
          }
        } catch {}
      }

      try {
        const buffer = await downloadWithRetry(item.imageUrl);
        writeFileSync(filepath, buffer);
        item.imageUrl = `${cat.localPrefix}/${filename}`;
        downloaded++;
      } catch (err) {
        console.error(`  FAIL: ${item.slug} (${item.name}) - ${err.message}`);
        item.imageUrl = null; // will use placeholder
        failed++;
      }
    }));

    const total = downloaded + skipped + failed;
    if (total % 50 < CONCURRENCY || i + CONCURRENCY >= toDownload.length) {
      console.log(`  ${total}/${toDownload.length} (${downloaded} new, ${skipped} cached, ${failed} failed)`);
    }
  }

  // Set null for items without image
  for (const item of items) {
    if (!item.imageUrl) continue;
    if (item.imageUrl.startsWith(cat.localPrefix)) {
      const filename = item.imageUrl.replace(`${cat.localPrefix}/`, '');
      const filepath = join(cat.outDir, filename);
      if (!existsSync(filepath)) {
        item.imageUrl = null;
      }
    }
  }

  // Write back
  writeFileSync(cat.dataFile, JSON.stringify(items, null, 2));
  console.log(`Done: ${downloaded} downloaded, ${skipped} cached, ${failed} failed`);
  return { downloaded, skipped, failed };
}

async function main() {
  let totalDl = 0, totalSkip = 0, totalFail = 0;
  for (const cat of CATEGORIES) {
    const { downloaded, skipped, failed } = await processCategory(cat);
    totalDl += downloaded;
    totalSkip += skipped;
    totalFail += failed;
  }
  console.log(`\n=== TOTAL: ${totalDl} downloaded, ${totalSkip} cached, ${totalFail} failed ===`);
}

main().catch(err => { console.error(err); process.exit(1); });
