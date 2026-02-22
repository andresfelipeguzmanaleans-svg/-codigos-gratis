/**
 * Scrape Roblox Music IDs from bloxodes.com
 *
 * Usage:
 *   node scripts/scrape-music-ids.mjs              # all pages
 *   node scripts/scrape-music-ids.mjs --max=50     # first 50 pages
 *   node scripts/scrape-music-ids.mjs --max=10 --concurrency=3
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'data', 'music-ids.json');

// --- CLI args ---
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace('--', '').split('=');
    return [k, v ? Number(v) : true];
  })
);
const MAX_PAGES = typeof args.max === 'number' ? args.max : Infinity;
const CONCURRENCY = typeof args.concurrency === 'number' ? args.concurrency : 15;
const DELAY_MS = typeof args.delay === 'number' ? args.delay : 50;

const BASE = 'https://bloxodes.com/catalog/roblox-music-ids';

// --- Helpers ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Extract songs from the HTML.
 *
 * The page is a Next.js RSC app. Song data is embedded in self.__next_f.push()
 * calls as a JS string literal. Inside that string:
 *   - Quotes are escaped as \"
 *   - Brackets [ ] are NOT escaped
 *   - The songs appear as: "initialSongs":[{"asset_id":...},...],"initialTotalPages":N
 *
 * We search the raw HTML for this pattern and parse the JSON array.
 */
function extractSongs(html) {
  const songs = [];

  // Find the initialSongs array in the raw HTML
  // The HTML contains: \"initialSongs\":[{\"asset_id\":...}]  (escaped quotes)
  const marker = '"initialSongs":[';
  const markerEsc = '\\"initialSongs\\":[';

  let startIdx = html.indexOf(marker);
  let escaped = false;
  if (startIdx === -1) {
    startIdx = html.indexOf(markerEsc);
    escaped = true;
  }

  if (startIdx !== -1) {
    // Move past the key to the array start
    const arrStart = html.indexOf('[', startIdx);

    // Find matching closing bracket by counting depth
    let depth = 0;
    let arrEnd = -1;
    let inStr = false;
    let prevChar = '';

    for (let i = arrStart; i < html.length && i < arrStart + 500000; i++) {
      const c = html[i];

      if (escaped) {
        // In escaped mode, \" is a literal quote inside the JS string
        // But we need to handle the escaped format: \\" means literal backslash + quote
        if (c === '\\' && html[i + 1] === '"') {
          if (!inStr) inStr = true;
          else if (prevChar !== '\\') inStr = false;
          i++; // skip the quote
          prevChar = '"';
          continue;
        }
      } else {
        if (c === '"' && prevChar !== '\\') {
          inStr = !inStr;
          prevChar = c;
          continue;
        }
      }

      if (!inStr) {
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) { arrEnd = i + 1; break; }
        }
      }
      prevChar = c;
    }

    if (arrEnd > arrStart) {
      let jsonStr = html.substring(arrStart, arrEnd);

      // If the HTML has escaped quotes (\"), unescape them for JSON parsing
      if (escaped) {
        jsonStr = jsonStr.replace(/\\"/g, '"');
      }

      try {
        const arr = JSON.parse(jsonStr);
        for (const s of arr) {
          if (s && s.asset_id) {
            songs.push({
              title: s.title || '',
              artist: s.artist || '',
              id: String(s.asset_id),
              genre: s.genre || '',
              ...(s.duration_seconds ? { duration: s.duration_seconds } : {}),
            });
          }
        }
      } catch {
        // Fallback: extract individual song objects via regex
        const objRegex = /\{[^{}]*"asset_id"\s*:\s*(\d+)[^{}]*"title"\s*:\s*"([^"]*)"[^{}]*"artist"\s*:\s*"([^"]*)"[^{}]*?"genre"\s*:\s*"?([^",}]*)"?[^{}]*\}/g;
        let om;
        while ((om = objRegex.exec(jsonStr)) !== null) {
          songs.push({
            title: om[2],
            artist: om[3],
            id: om[1],
            genre: (om[4] || '').replace(/null/, ''),
          });
        }
      }
    }
  }

  // Extract total pages
  let totalPages = null;
  const tpMatch = html.match(/"initialTotalPages"\\?:(\d+)/) || html.match(/initialTotalPages.*?(\d{2,})/);
  if (tpMatch) totalPages = parseInt(tpMatch[1], 10);

  return { songs, totalPages };
}

async function fetchPage(pageNum) {
  const url = pageNum === 1 ? BASE : `${BASE}/page/${pageNum}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for page ${pageNum}`);
    return res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// --- Main ---
async function main() {
  console.log('Fetching page 1 to determine total pages...');
  const html1 = await fetchPage(1);
  const { songs: firstSongs, totalPages: detectedTotal } = extractSongs(html1);

  const totalPages = Math.min(detectedTotal || 1, MAX_PAGES);
  console.log(`Found ${firstSongs.length} songs on page 1`);
  console.log(`Total pages available: ${detectedTotal || '?'}, will scrape: ${totalPages}`);

  const allSongs = new Map();
  for (const s of firstSongs) allSongs.set(s.id, s);

  // Fetch remaining pages with concurrency control
  let completed = 1;
  let failed = 0;

  async function fetchAndParse(pageNum) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const html = await fetchPage(pageNum);
        const { songs } = extractSongs(html);
        for (const s of songs) allSongs.set(s.id, s);
        completed++;
        if (completed % 50 === 0 || completed === totalPages) {
          console.log(`  Progress: ${completed}/${totalPages} pages — ${allSongs.size} unique songs (failed: ${failed})`);
        }
        return;
      } catch (err) {
        if (attempt < 2) {
          console.error(`  Retry ${attempt + 1} for page ${pageNum}: ${err.message}`);
          await sleep(2000 * (attempt + 1));
        } else {
          failed++;
          completed++;
          console.error(`  FAILED page ${pageNum} after 3 attempts: ${err.message}`);
        }
      }
    }
  }

  // Process in batches of CONCURRENCY
  const remaining = [];
  for (let p = 2; p <= totalPages; p++) remaining.push(p);

  let batchSize = CONCURRENCY;
  let prevFailed = 0;

  while (remaining.length > 0) {
    const batch = remaining.splice(0, batchSize);
    await Promise.all(batch.map((p) => fetchAndParse(p)));

    // Adaptive: if errors increased, slow down
    if (failed > prevFailed) {
      batchSize = Math.max(3, Math.floor(batchSize / 2));
      console.log(`  Slowing down to ${batchSize} concurrent requests`);
      await sleep(1000);
    }
    prevFailed = failed;

    if (remaining.length > 0) await sleep(DELAY_MS);
  }

  // Sort by ID
  const songs = [...allSongs.values()].sort((a, b) => {
    const na = BigInt(a.id), nb = BigInt(b.id);
    return na < nb ? -1 : na > nb ? 1 : 0;
  });

  // Save
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ songs }, null, 2), 'utf-8');

  console.log('\n--- Done ---');
  console.log(`Total unique songs: ${songs.length}`);
  console.log(`Failed pages: ${failed}`);
  console.log(`Saved to: ${OUTPUT}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
