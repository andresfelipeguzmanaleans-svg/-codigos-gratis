const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'data', 'games');
const BATCH_SIZE = 50;
const DELAY_MS = 500;

// The 45 not-found games from the first run
const NOT_FOUND_SLUGS = [
  'anime-stars-simulator', 'animentals', 'aniverse-battlegrounds',
  'bathtub-tower-defense', 'azure-lock', 'bathtub-warfare',
  'bubble-gum-mayhem', 'champions-td', 'coding-simulator',
  'deadly-sins-retribution', 'defense-derby', 'dungeon-quest',
  'fire-force-online', 'final-sea', 'free-hatchers',
  'get-richer-every-click', 'grimace-race', 'heroes-awakening',
  'hunter-x-unleashed', 'jujutsu-academy', 'launch-into-space-simulator',
  'last-pirates', 'king-of-sea', 'legend-piece', 'lost-pirates',
  'multiverse-defenders', 'my-hero-mania', 'one-piece-new-dreams',
  'one-shot', 'project-new-world', 'punch-a-skibi', 'ro-fruits-2',
  'ro-ghoul', 'robending-online', 'runstar-simulator', 'samurai-parallel',
  'shadow-boxing-fights', 'skibi-battle-simulator', 'slap-battles-elude',
  'soccer-ball', 'solo-blox-leveling', 'soul-strike',
  'super-power-fighting-simulator', 'the-resistance-tycoon',
  'war-of-the-grand-line'
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Improved normalize: replace hyphens/underscores with spaces first
function normalize(name) {
  return name
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// More lenient matching
function namesMatch(jsonName, apiName) {
  const a = normalize(jsonName);
  const b = normalize(apiName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Word-based matching
  const wordsA = a.split(' ').filter(w => w.length > 1);
  const wordsB = b.split(' ').filter(w => w.length > 1);
  if (wordsA.length === 0) return false;

  // Count how many words from the JSON name appear in the API name
  let matchCount = 0;
  for (const w of wordsA) {
    if (wordsB.some(wb => wb.includes(w) || w.includes(wb))) matchCount++;
  }

  // If most words from the shorter name match, accept
  const ratio = matchCount / wordsA.length;
  return ratio >= 0.7 && matchCount >= 2;
}

async function searchGame(gameName) {
  const query = encodeURIComponent(gameName);
  const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${query}&searchType=games&pageToken=&sessionId=retry${Date.now()}`;

  try {
    const data = await fetchJSON(url);
    const results = data.searchResults || [];

    // Check more results with lenient matching
    for (const group of results.slice(0, 10)) {
      const content = group.contents && group.contents[0];
      if (!content) continue;

      if (namesMatch(gameName, content.name)) {
        return {
          universeId: content.universeId,
          name: content.name,
          playerCount: content.playerCount || 0,
          totalUpVotes: content.totalUpVotes || 0,
          rootPlaceId: content.rootPlaceId || 0,
          creatorName: content.creatorName || '',
        };
      }
    }

    // If no match found, show what was returned
    const first = results[0] && results[0].contents && results[0].contents[0];
    if (first) {
      console.log(`    API returned: "${first.name}" for "${gameName}"`);
    }
    return null;
  } catch (e) {
    console.log(`    Error searching "${gameName}": ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('=== Retry Search for Not-Found Games ===\n');

  const matched = [];
  const stillNotFound = [];

  for (let i = 0; i < NOT_FOUND_SLUGS.length; i++) {
    const slug = NOT_FOUND_SLUGS[i];
    const filePath = path.join(GAMES_DIR, `codigos-${slug}.json`);

    if (!fs.existsSync(filePath)) {
      // Try without codigos prefix
      const alt = path.join(GAMES_DIR, `${slug}.json`);
      if (!fs.existsSync(alt)) {
        console.log(`  [SKIP] File not found for slug: ${slug}`);
        continue;
      }
    }

    const fp = fs.existsSync(path.join(GAMES_DIR, `codigos-${slug}.json`))
      ? path.join(GAMES_DIR, `codigos-${slug}.json`)
      : path.join(GAMES_DIR, `${slug}.json`);

    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    console.log(`[${i + 1}/${NOT_FOUND_SLUGS.length}] Searching: ${data.name}`);

    const result = await searchGame(data.name);
    if (result) {
      console.log(`  ✓ Matched: "${result.name}" (uid: ${result.universeId})`);
      matched.push({ filePath: fp, data, match: result });
    } else {
      stillNotFound.push(data.name);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n--- Results: ${matched.length} matched, ${stillNotFound.length} still not found ---\n`);

  if (matched.length === 0) {
    console.log('No new matches. Done.');
    return;
  }

  // Fetch thumbnails
  const uids = matched.map(m => m.match.universeId);
  const allThumbs = {};
  const allDetails = {};
  const allVotes = {};

  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const batch = uids.slice(i, i + BATCH_SIZE);
    const uidStr = batch.join(',');
    try {
      const [thumbResp, detailResp, voteResp] = await Promise.all([
        fetchJSON(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${uidStr}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`),
        fetchJSON(`https://games.roblox.com/v1/games?universeIds=${uidStr}`),
        fetchJSON(`https://games.roblox.com/v1/games/votes?universeIds=${uidStr}`)
      ]);
      for (const t of (thumbResp.data || [])) allThumbs[t.targetId] = t.imageUrl || '';
      for (const d of (detailResp.data || [])) allDetails[d.id] = d;
      for (const v of (voteResp.data || [])) allVotes[v.id] = v;
    } catch (e) {
      console.error(`  API batch error: ${e.message}`);
    }
  }

  // Update files
  let updated = 0;
  for (const { filePath, data, match } of matched) {
    const uid = match.universeId;
    const thumb = allThumbs[uid];
    const detail = allDetails[uid];
    const vote = allVotes[uid];
    if (!thumb) continue;

    data.thumbnail = thumb;
    data.playerCount = detail ? detail.playing : match.playerCount;
    data.totalVisits = detail ? detail.visits : 0;
    data.likes = vote ? vote.upVotes : match.totalUpVotes;
    data.genre = detail ? (detail.genre || '') : '';
    data.placeId = detail ? (detail.rootPlaceId || match.rootPlaceId) : match.rootPlaceId;

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    updated++;
  }

  console.log(`Updated: ${updated} files`);

  if (stillNotFound.length > 0) {
    console.log(`\n--- Still not found (${stillNotFound.length}) ---`);
    for (const n of stillNotFound) console.log(`  ${n}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
