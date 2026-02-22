const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'data', 'games');
const BATCH_SIZE = 50;
const CONCURRENCY = 3;
const DELAY_MS = 300;

// Non-Roblox games (mobile/PC/console) — won't exist on Roblox
const NON_ROBLOX = new Set([
  'afk-arena', 'afk-journey', 'arena-breakout', 'arknights',
  'black-clover-m', 'brawlhalla', 'brixity', 'brown-dust-2',
  'call-of-dragons', 'call-of-duty-warzone-mobile', 'captain-tsubasa-ace',
  'cod-mobile-redeem', 'cookie-run-kingdom', 'cookie-run-ovenbreak',
  'cyber-rebellion', 'dead-by-daylight', 'devil-may-cry-peak-of-combat',
  'disney-dreamlight-valley', 'disney-speedstorm', 'dragon-nest-2-evolution',
  'dragonheir-silent-gods', 'dungeon-hunter-6', 'eatventure', 'echocalypse',
  'fairy-tail-fierce-fight', 'farlight-84', 'fortress-saga', 'free-fire-redeem',
  'gacha-life-2', 'genshin-impact', 'genshin-impact-4-0',
  'genshin-impact-4-2-estan-aqui', 'grand-cross-age-of-titans',
  'guardian-tales', 'honkai-impact', 'honkai-star-rail',
  'honkai-star-rail-1-5-estan-aqui', 'honor-of-kings',
  'isekai-slow-life', 'legend-of-immortals', 'love-and-deepspace',
  'lovebrush-chronicles', 'madtale', 'magic-chronicle', 'metal-slug-awakening',
  'mobile-legends-redeem', 'monster-hunter-now', 'monster-never-cry',
  'my-singing-monsters-friend', 'nba-2k-mobile', 'nba-2k24-locker',
  'oh-my-dog', 'omniheroes', 'one-punch-man-world', 'overmortal',
  'pokemon-go-promo', 'pokemon-unite', 'primon-legion', 'reverse-1999',
  'sea-of-conquest', 'seven-knights-idle-adventure', 'shield-hero-rise',
  'slam-dunk-from-tv-animation', 'snowbreak', 'soul-knight-prequel',
  'soul-knight', 'splatoon-3', 'stumble-guys', 'super-cat-tales-codigos',
  'super-snail', 'survivor-io', 'sword-chronicles-awaken', 'takt-op-symphony',
  'tangled-web-chronicles', 'tokyo-ghoul-break-the-chains', 'tower-of-fantasy',
  'tower-of-god-new-world', 'undawn', 'watcher-of-realms', 'whiteout-survival',
  'zenless-zone-zero', 'mob-control-redemption'
]);

// Informational/meta pages — not actual games
const INFORMATIONAL = new Set([
  'all-geometry-dash-2-2-vault', 'de-dawnlands-hay-alguno',
  'de-punch-a-anime', 'de-regalo-misteriosos-de-pokemon-escarlata-y-violeta',
  'de-seguridad-resident-evil-2', 'de-seguridad-resident-evil-3',
  'demonfall-codes', 'musica-de-roblox', 'persona-5-kaneshiro',
  'promocionales-de-roblox-y-como-canjearlos', 'raid-promo',
  'shinobi-life-2-giros-gratis-y-rellcoins'
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Normalize a game name for comparison
function normalize(name) {
  return name
    .replace(/\[.*?\]/g, '')           // remove [brackets]
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '') // remove emojis
    .replace(/[^a-zA-Z0-9\s]/g, '')    // remove special chars
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if two game names match
function namesMatch(jsonName, apiName) {
  const a = normalize(jsonName);
  const b = normalize(apiName);
  if (!a || !b) return false;

  // Exact match
  if (a === b) return true;

  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;

  // Word overlap (Jaccard similarity)
  const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;

  // High similarity threshold
  return jaccard >= 0.5 && intersection >= Math.min(wordsA.size, wordsB.size);
}

// Search Roblox for a game by name, return best match
async function searchGame(gameName) {
  const query = encodeURIComponent(gameName);
  const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${query}&searchType=games&pageToken=&sessionId=search${Date.now()}`;

  try {
    const data = await fetchJSON(url);
    const results = data.searchResults || [];

    // Check first few results for a match
    for (const group of results.slice(0, 5)) {
      const content = group.contents && group.contents[0];
      if (!content) continue;

      if (namesMatch(gameName, content.name)) {
        return {
          universeId: content.universeId,
          name: content.name,
          playerCount: content.playerCount || 0,
          totalUpVotes: content.totalUpVotes || 0,
          totalDownVotes: content.totalDownVotes || 0,
          rootPlaceId: content.rootPlaceId || 0,
          creatorName: content.creatorName || '',
          description: content.description || ''
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Process items in parallel with concurrency limit
async function parallelMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      await sleep(DELAY_MS);
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
  console.log('=== Roblox Game Search & Update ===\n');

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

  // Step 2: Filter out non-Roblox and informational pages
  const robloxGames = [];
  const skipped = [];

  for (const item of toUpdate) {
    const slug = (item.data.slug || '').replace(/^codigos?-/, '');
    if (NON_ROBLOX.has(slug) || INFORMATIONAL.has(slug)) {
      skipped.push(item.data.name);
    } else {
      robloxGames.push({ ...item, slug });
    }
  }

  console.log(`Roblox games to search: ${robloxGames.length}`);
  console.log(`Skipped (non-Roblox/info): ${skipped.length}\n`);

  // Step 3: Search for each game using omni-search API
  console.log('Searching Roblox by game name...');
  let foundCount = 0;
  let notFoundCount = 0;
  const notFoundList = [];

  const searchResults = await parallelMap(robloxGames, async (game, i) => {
    const result = await searchGame(game.data.name);
    if (result) {
      foundCount++;
      if (foundCount % 25 === 0) console.log(`  ... ${foundCount} found (${i + 1}/${robloxGames.length})`);
      return { ...game, match: result };
    } else {
      notFoundCount++;
      notFoundList.push(`  ${game.data.name} (${game.slug})`);
      return null;
    }
  }, CONCURRENCY);

  const gamesWithMatch = searchResults.filter(Boolean);
  console.log(`\nSearch done: ${gamesWithMatch.length} found, ${notFoundCount} not found\n`);

  if (gamesWithMatch.length === 0) {
    console.log('No games found. Exiting.');
    return;
  }

  // Step 4: Fetch thumbnails in batches
  console.log('Fetching thumbnails...');
  const allThumbs = {};
  const universeIds = gamesWithMatch.map(g => g.match.universeId);

  for (let i = 0; i < universeIds.length; i += BATCH_SIZE) {
    const batch = universeIds.slice(i, i + BATCH_SIZE);
    const uidStr = batch.join(',');
    try {
      const thumbResp = await fetchJSON(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${uidStr}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`
      );
      for (const t of (thumbResp.data || [])) {
        allThumbs[t.targetId] = t.imageUrl || '';
      }
    } catch (e) {
      console.error(`  Thumbnail batch error at ${i}: ${e.message}`);
    }
    if (i + BATCH_SIZE < universeIds.length) await sleep(300);
  }

  console.log(`  Loaded ${Object.keys(allThumbs).length} thumbnails\n`);

  // Step 5: Also fetch full game details and votes (for accurate data)
  console.log('Fetching game details & votes...');
  const allDetails = {};
  const allVotes = {};

  for (let i = 0; i < universeIds.length; i += BATCH_SIZE) {
    const batch = universeIds.slice(i, i + BATCH_SIZE);
    const uidStr = batch.join(',');
    try {
      const [detailsResp, votesResp] = await Promise.all([
        fetchJSON(`https://games.roblox.com/v1/games?universeIds=${uidStr}`),
        fetchJSON(`https://games.roblox.com/v1/games/votes?universeIds=${uidStr}`)
      ]);
      for (const d of (detailsResp.data || [])) allDetails[d.id] = d;
      for (const v of (votesResp.data || [])) allVotes[v.id] = v;
    } catch (e) {
      console.error(`  Details batch error at ${i}: ${e.message}`);
    }
    if (i + BATCH_SIZE < universeIds.length) await sleep(300);
  }

  console.log(`  Loaded ${Object.keys(allDetails).length} details, ${Object.keys(allVotes).length} votes\n`);

  // Step 6: Update JSON files
  console.log('Writing updated JSON files...');
  let updated = 0;

  for (const { filePath, data, match } of gamesWithMatch) {
    const uid = match.universeId;
    const thumb = allThumbs[uid] || '';
    const detail = allDetails[uid];
    const vote = allVotes[uid];

    if (!thumb) continue; // Skip if no thumbnail

    data.thumbnail = thumb;
    data.playerCount = detail ? detail.playing : match.playerCount;
    data.totalVisits = detail ? detail.visits : 0;
    data.likes = vote ? vote.upVotes : match.totalUpVotes;
    data.genre = detail ? (detail.genre || '') : '';
    data.placeId = detail ? (detail.rootPlaceId || match.rootPlaceId) : match.rootPlaceId;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    updated++;
  }

  // Summary
  console.log(`\n========== SUMMARY ==========`);
  console.log(`Total JSON files:          ${files.length}`);
  console.log(`Already had thumbnail:     ${alreadyGood}`);
  console.log(`Needed update:             ${toUpdate.length}`);
  console.log(`Skipped (non-Roblox/info): ${skipped.length}`);
  console.log(`Roblox games searched:     ${robloxGames.length}`);
  console.log(`Matched via search:        ${gamesWithMatch.length}`);
  console.log(`Successfully updated:      ${updated}`);
  console.log(`Not found:                 ${notFoundCount}`);
  console.log(`=============================`);

  if (notFoundList.length > 0) {
    console.log(`\n--- Not found (${notFoundList.length}) ---`);
    for (const line of notFoundList) console.log(line);
  }
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
