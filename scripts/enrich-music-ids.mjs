/**
 * Enrich data/music-ids.json with thumbnails from Roblox API
 * and robloxUrl for the first N songs.
 *
 * Usage:
 *   node scripts/enrich-music-ids.mjs              # first 500
 *   node scripts/enrich-music-ids.mjs --count=1000 # first 1000
 *
 * Also re-scrapes bloxodes to recover duration_seconds for those songs.
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '..', 'data', 'music-ids.json');
const PUBLIC_PATH = resolve(__dirname, '..', 'public', 'data', 'music-ids.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace('--', '').split('=');
    return [k, v ? Number(v) : true];
  })
);
const COUNT = typeof args.count === 'number' ? args.count : 500;
const THUMB_BATCH = 50;
const BLOXODES_BASE = 'https://bloxodes.com/catalog/roblox-music-ids';
const PLACEHOLDER_THUMB = 'https://t2.rbxcdn.com/180DAY-aabc378ca561434a063f7c8692f72d61';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ──── Step 1: Fetch thumbnails from Roblox API ────

async function fetchThumbnails(ids) {
  const thumbMap = new Map();
  const batches = [];

  for (let i = 0; i < ids.length; i += THUMB_BATCH) {
    batches.push(ids.slice(i, i + THUMB_BATCH));
  }

  console.log(`Fetching thumbnails: ${batches.length} batches of up to ${THUMB_BATCH}...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const url = `https://thumbnails.roblox.com/v1/assets?assetIds=${batch.join(',')}&size=150x150&format=Png`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        for (const item of data.data) {
          if (item.state === 'Completed' && item.imageUrl && item.imageUrl !== PLACEHOLDER_THUMB) {
            thumbMap.set(String(item.targetId), item.imageUrl);
          }
        }
        break;
      } catch (err) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
        } else {
          console.error(`  Failed batch ${i + 1}: ${err.message}`);
        }
      }
    }

    if ((i + 1) % 5 === 0 || i === batches.length - 1) {
      console.log(`  Batch ${i + 1}/${batches.length} — ${thumbMap.size} thumbnails found`);
    }
    await sleep(100);
  }

  return thumbMap;
}

// ──── Step 2: Re-scrape bloxodes for duration data ────

function extractDurations(html) {
  const durations = new Map();

  const marker = '"initialSongs":[';
  const markerEsc = '\\"initialSongs\\":[';
  let startIdx = html.indexOf(marker);
  let escaped = false;
  if (startIdx === -1) {
    startIdx = html.indexOf(markerEsc);
    escaped = true;
  }
  if (startIdx === -1) return durations;

  const arrStart = html.indexOf('[', startIdx);
  let depth = 0;
  let arrEnd = -1;
  let inStr = false;
  let prevChar = '';

  for (let i = arrStart; i < html.length && i < arrStart + 500000; i++) {
    const c = html[i];
    if (escaped) {
      if (c === '\\' && html[i + 1] === '"') {
        if (!inStr) inStr = true;
        else if (prevChar !== '\\') inStr = false;
        i++;
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

  if (arrEnd <= arrStart) return durations;

  let jsonStr = html.substring(arrStart, arrEnd);
  if (escaped) jsonStr = jsonStr.replace(/\\"/g, '"');

  try {
    const arr = JSON.parse(jsonStr);
    for (const s of arr) {
      if (s && s.asset_id && s.duration_seconds) {
        durations.set(String(s.asset_id), s.duration_seconds);
      }
    }
  } catch { /* ignore */ }

  return durations;
}

async function scrapeDurations(targetIds) {
  const durationMap = new Map();
  const targetSet = new Set(targetIds);
  let found = 0;
  const maxPages = Math.min(100, Math.ceil(targetIds.length / 24) * 3);

  console.log(`\nScraping bloxodes for durations (up to ${maxPages} pages)...`);

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? BLOXODES_BASE : `${BLOXODES_BASE}/page/${page}`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const pageDurations = extractDurations(html);

      for (const [id, dur] of pageDurations) {
        if (targetSet.has(id) && !durationMap.has(id)) {
          durationMap.set(id, dur);
          found++;
        }
      }

      if (page % 10 === 0) {
        console.log(`  Page ${page}/${maxPages} — ${found} durations matched`);
      }

      // Stop early if we found most of them
      if (found >= targetIds.length * 0.9) {
        console.log(`  Found ${found}/${targetIds.length} durations, stopping early`);
        break;
      }

      await sleep(80);
    } catch { /* skip */ }
  }

  console.log(`  Total durations recovered: ${found}`);
  return durationMap;
}

// ──── Main ────

async function main() {
  console.log(`Loading ${DATA_PATH}...`);
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const total = data.songs.length;
  const enrichCount = Math.min(COUNT, total);

  console.log(`Total songs: ${total}, enriching first ${enrichCount}\n`);

  const targetSongs = data.songs.slice(0, enrichCount);
  const targetIds = targetSongs.map((s) => s.id);

  // 1. Thumbnails
  const thumbMap = await fetchThumbnails(targetIds);
  console.log(`\nThumbnails found: ${thumbMap.size}/${enrichCount}`);

  // 2. Durations (only for songs that don't already have duration)
  const needDuration = targetSongs.filter((s) => !s.duration).map((s) => s.id);
  let durationMap = new Map();
  if (needDuration.length > 0) {
    durationMap = await scrapeDurations(needDuration);
  } else {
    console.log('\nAll target songs already have duration, skipping scrape');
  }

  // 3. Apply enrichments
  let thumbAdded = 0;
  let durAdded = 0;
  let urlAdded = 0;

  for (let i = 0; i < enrichCount; i++) {
    const song = data.songs[i];

    // Thumbnail
    const thumb = thumbMap.get(song.id);
    if (thumb) {
      song.thumbnail = thumb;
      thumbAdded++;
    }

    // Duration
    if (!song.duration) {
      const dur = durationMap.get(song.id);
      if (dur) {
        song.duration = dur;
        durAdded++;
      }
    }

    // Roblox URL
    if (!song.robloxUrl) {
      song.robloxUrl = `https://www.roblox.com/library/${song.id}`;
      urlAdded++;
    }
  }

  // 4. Save
  writeFileSync(DATA_PATH, JSON.stringify({ songs: data.songs }, null, 2), 'utf-8');
  copyFileSync(DATA_PATH, PUBLIC_PATH);

  console.log('\n--- Done ---');
  console.log(`Thumbnails added: ${thumbAdded}/${enrichCount}`);
  console.log(`Durations added: ${durAdded} (${targetSongs.filter((s) => s.duration).length} total with duration)`);
  console.log(`Roblox URLs added: ${urlAdded}`);
  console.log(`Saved to: ${DATA_PATH}`);
  console.log(`Copied to: ${PUBLIC_PATH}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
