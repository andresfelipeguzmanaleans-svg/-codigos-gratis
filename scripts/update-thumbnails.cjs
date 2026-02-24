const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'data', 'games');
const BATCH_SIZE = 50;
const CONCURRENCY = 5; // parallel HTTP requests for scraping

// Known non-Roblox games (won't have roblox.com/games links)
const NON_ROBLOX = [
  'brawlhalla', 'nba-2k-mobile', 'guardian-tales', 'soul-knight-prequel',
  'farlight-84', 'disney-speedstorm', 'afk-arena', 'afk-journey',
  'geometry-dash', 'war-thunder', 'genshin-impact', 'honkai-star-rail',
  'call-of-duty-mobile', 'pubg-mobile', 'free-fire', 'clash-royale',
  'clash-of-clans', 'coin-master', 'raid-shadow-legends'
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(10000)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Extract placeId from a webpage HTML
function extractPlaceId(html) {
  const matches = html.match(/roblox\.com\/games\/(\d+)/g);
  if (!matches) return null;
  const ids = matches.map(m => m.match(/(\d+)/)[1]);
  const counts = {};
  for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

// Try to find placeId from codes websites
async function findPlaceId(gameSlug) {
  // Try TryHardGuides first (best coverage)
  try {
    const html = await fetchText(`https://tryhardguides.com/${gameSlug}-codes/`);
    const pid = extractPlaceId(html);
    if (pid) return pid;
  } catch {}

  // Fallback: Beebom
  try {
    const html = await fetchText(`https://beebom.com/roblox-${gameSlug}-codes/`);
    const pid = extractPlaceId(html);
    if (pid) return pid;
  } catch {}

  return null;
}

// Process items in parallel with concurrency limit
async function parallelMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('=== Roblox Game Data Updater ===\n');

  // Step 1: Read all JSON files with empty thumbnails
  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  console.log(`Total JSON files: ${files.length}`);

  const toUpdate = [];
  let alreadyGood = 0;

  for (const file of files) {
    const filePath = path.join(GAMES_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.thumbnail) {
      toUpdate.push({ file, filePath, data });
    } else {
      alreadyGood++;
    }
  }

  console.log(`Already have thumbnail: ${alreadyGood}`);
  console.log(`Need update: ${toUpdate.length}\n`);

  // Filter out non-Roblox games
  const robloxGames = [];
  const skippedNonRoblox = [];

  for (const item of toUpdate) {
    const slug = (item.data.slug || '').replace(/^codigos?-/, '');
    if (NON_ROBLOX.some(nr => slug.includes(nr))) {
      skippedNonRoblox.push(item.data.name);
    } else {
      robloxGames.push({ ...item, slug });
    }
  }

  console.log(`Roblox games to search: ${robloxGames.length}`);
  console.log(`Skipped non-Roblox: ${skippedNonRoblox.length}\n`);

  // Step 2: Find placeIds in parallel (5 concurrent)
  console.log('Searching for placeIds on codes websites...');
  let found = 0, notFoundCount = 0;

  const searchResults = await parallelMap(robloxGames, async (game, i) => {
    const placeId = await findPlaceId(game.slug);
    if (placeId) {
      found++;
      if (found % 50 === 0) console.log(`  ... ${found} found so far`);
      return { ...game, placeId };
    } else {
      notFoundCount++;
      console.log(`  [NOT FOUND] ${game.data.name} (${game.slug})`);
      return null;
    }
  }, CONCURRENCY);

  const gamesWithPlaceId = searchResults.filter(Boolean);
  console.log(`\nSearch complete: ${gamesWithPlaceId.length} found, ${notFoundCount} not found\n`);

  if (gamesWithPlaceId.length === 0) {
    console.log('No games found. Exiting.');
    return;
  }

  // Step 3: Convert placeIds to universeIds (batches of 20)
  console.log('Fetching universe IDs...');
  const gameUniverseMap = [];

  for (let i = 0; i < gamesWithPlaceId.length; i += 20) {
    const batch = gamesWithPlaceId.slice(i, i + 20);
    const results = await Promise.allSettled(
      batch.map(async g => {
        const data = await fetchJSON(`https://apis.roblox.com/universes/v1/places/${g.placeId}/universe`);
        return { ...g, universeId: data.universeId };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.universeId) {
        gameUniverseMap.push(r.value);
      } else if (r.status === 'rejected') {
        // Invalid placeId, skip
      }
    }
    if (i + 20 < gamesWithPlaceId.length) await sleep(200);
  }

  console.log(`Universe IDs resolved: ${gameUniverseMap.length}\n`);

  // Step 4: Batch fetch details, thumbnails, votes
  console.log('Fetching game details from Roblox API...');
  const allDetails = {};
  const allThumbs = {};
  const allVotes = {};

  for (let i = 0; i < gameUniverseMap.length; i += BATCH_SIZE) {
    const batch = gameUniverseMap.slice(i, i + BATCH_SIZE);
    const uids = batch.map(g => g.universeId);
    const uidStr = uids.join(',');

    try {
      const [detailsResp, thumbsResp, votesResp] = await Promise.all([
        fetchJSON(`https://games.roblox.com/v1/games?universeIds=${uidStr}`),
        fetchJSON(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${uidStr}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`),
        fetchJSON(`https://games.roblox.com/v1/games/votes?universeIds=${uidStr}`)
      ]);

      for (const d of (detailsResp.data || [])) allDetails[d.id] = d;
      for (const t of (thumbsResp.data || [])) allThumbs[t.targetId] = t;
      for (const v of (votesResp.data || [])) allVotes[v.id] = v;
    } catch (e) {
      console.error(`  Batch error at ${i}: ${e.message}`);
    }

    if (i + BATCH_SIZE < gameUniverseMap.length) await sleep(300);
  }

  console.log(`  Loaded ${Object.keys(allDetails).length} details, ${Object.keys(allThumbs).length} thumbnails, ${Object.keys(allVotes).length} votes\n`);

  // Step 5: Update JSON files
  console.log('Writing updated JSON files...');
  let updated = 0;

  for (const { filePath, data, placeId, universeId } of gameUniverseMap) {
    const detail = allDetails[universeId];
    const thumb = allThumbs[universeId];
    const vote = allVotes[universeId];

    if (!detail) continue;

    // Update ONLY API fields, never touch activeCodes/expiredCodes
    data.thumbnail = (thumb && thumb.imageUrl) || '';
    data.playerCount = detail.playing || 0;
    data.totalVisits = detail.visits || 0;
    data.likes = (vote && vote.upVotes) || 0;
    data.genre = detail.genre || '';
    data.placeId = detail.rootPlaceId || parseInt(placeId);

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    updated++;
  }

  // Summary
  console.log(`\n========== SUMMARY ==========`);
  console.log(`Total JSON files:        ${files.length}`);
  console.log(`Already had thumbnail:   ${alreadyGood}`);
  console.log(`Needed update:           ${toUpdate.length}`);
  console.log(`Skipped (non-Roblox):    ${skippedNonRoblox.length}`);
  console.log(`PlaceIds found:          ${gamesWithPlaceId.length}`);
  console.log(`Successfully updated:    ${updated}`);
  console.log(`Not found on sites:      ${notFoundCount}`);
  console.log(`=============================`);

  // List not-found games
  const notFoundGames = searchResults.filter(r => r === null);
  const notFoundNames = robloxGames.filter((_, i) => searchResults[i] === null);
  if (notFoundNames.length > 0) {
    console.log(`\n--- Not found (${notFoundNames.length}) ---`);
    for (const g of notFoundNames) {
      console.log(`  ${g.data.name} (${g.slug})`);
    }
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
