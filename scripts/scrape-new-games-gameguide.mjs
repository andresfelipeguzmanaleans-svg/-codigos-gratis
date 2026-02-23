/**
 * scrape-new-games-gameguide.mjs
 *
 * Discovers new Roblox games from game.guide that we don't have yet,
 * scrapes their codes, fetches Roblox API data, and creates JSON files.
 *
 * STEP 1: Fetch game.guide/roblox-game-codes index → extract game slugs from RSC payload
 *         (initial page embeds ~60 games; attempts pagination for more)
 * STEP 2: Filter games not yet in data/games/
 * STEP 3: For each new game, scrape codes from its game.guide page
 * STEP 4: Look up Roblox API data (search → universeId → details + thumbnail + placeId)
 * STEP 5: Create data/games/codigos-{slug}.json
 *
 * Usage: node scripts/scrape-new-games-gameguide.mjs [--limit N] [--dry-run] [--min-codes N]
 *
 *   --limit N      Only process N new games (default: all)
 *   --dry-run      Don't write files, just show what would be created
 *   --min-codes N  Only create games with at least N active codes (default: 0)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const GAMES_DIR = 'data/games';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GG_DELAY = 2000;   // 2s between game.guide requests
const ROBLOX_DELAY = 1000; // 1s between Roblox API requests
const GG_BASE = 'https://www.game.guide';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const opts = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': UA, ...headers },
      timeout: 20000,
    };
    const req = https.get(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.hostname}${res.headers.location}`;
        return httpGet(loc, headers).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Reward translation (EN → ES) — same as rescrape-gameguide.mjs
// ---------------------------------------------------------------------------

const PHRASE_MAP = {
  'redeem this code for a': '', 'redeem this code to get a': '',
  'redeem this code to get': '', 'redeem this code for': '',
  'redeem this code to': '', 'redeem for a': '', 'redeem for': '',
  'redeem code for': '', 'redeem code to get': '',
  'free stat reset': 'reinicio de stats gratis',
  'stat reset': 'reinicio de stats', 'stat refund': 'reinicio de stats',
  'reset your stats': 'reiniciar tus stats',
  'in-game title': 'título del juego',
  'double xp': '2x EXP', '2x xp': '2x EXP', '2x exp': '2x EXP',
  '3x xp': '3x EXP', '2x experience': '2x experiencia',
  '2x coins': '2x monedas', 'triple coins': 'triple monedas',
  'expired reward': 'Recompensa expirada', 'freebies': 'Recompensas gratis',
  'unknown reward': 'Recompensa desconocida',
};

const WORD_MAP = {
  'free': 'gratis', 'coins': 'monedas', 'coin': 'moneda',
  'gems': 'gemas', 'gem': 'gema', 'gold': 'oro',
  'cash': 'Cash', 'bucks': 'Bucks', 'money': 'dinero',
  'tokens': 'tokens', 'diamonds': 'diamantes', 'diamond': 'diamante',
  'crystals': 'cristales', 'credits': 'créditos',
  'energy': 'energía', 'points': 'puntos', 'stars': 'estrellas',
  'boost': 'Boost', 'boosts': 'Boosts',
  'double': 'doble', 'triple': 'triple',
  'minutes': 'minutos', 'minute': 'minuto',
  'hours': 'horas', 'hour': 'hora',
  'skin': 'skin', 'skins': 'skins',
  'pet': 'mascota', 'pets': 'mascotas',
  'crate': 'cofre', 'crates': 'cofres', 'chest': 'cofre', 'chests': 'cofres',
  'key': 'llave', 'keys': 'llaves',
  'reward': 'recompensa', 'rewards': 'recompensas',
  'item': 'objeto', 'items': 'objetos',
  'title': 'título', 'potion': 'poción', 'potions': 'pociones',
  'ticket': 'ticket', 'tickets': 'tickets',
  'spin': 'giro', 'spins': 'giros', 'roll': 'tirada', 'rolls': 'tiradas',
  'summon': 'invocación', 'summons': 'invocaciones',
  'strength': 'fuerza', 'speed': 'velocidad',
  'damage': 'daño', 'experience': 'experiencia',
  'gift': 'regalo', 'luck': 'suerte',
  'limited': 'limitado', 'exclusive': 'exclusivo',
  'special': 'especial', 'rare': 'raro', 'legendary': 'legendario',
  'arrows': 'flechas', 'arrow': 'flecha',
};

function translateReward(text) {
  if (!text) return 'Recompensa gratis';
  let result = unescapeHtml(text).trim();
  result = result.replace(/\s*\(NEW\)\s*/gi, '').trim();

  for (const [en, es] of Object.entries(PHRASE_MAP)) {
    const regex = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, es);
  }
  result = result.replace(/^\s*[,.:;–—-]\s*/, '').trim();
  result = result.replace(/\bFree\s+(.+)/i, (_, rest) => rest.trim() + ' gratis');

  for (const [en, es] of Object.entries(WORD_MAP)) {
    const regex = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, es);
  }

  result = result.replace(/gratis\s+gratis/gi, 'gratis');
  result = result.charAt(0).toUpperCase() + result.slice(1);
  result = result.replace(/\.\s*$/, '').replace(/\s*\[.*$/, '').trim();
  if (!result || result.length < 2) result = 'Recompensa gratis';
  return result;
}

// ---------------------------------------------------------------------------
// STEP 1: Get game list from game.guide index
// ---------------------------------------------------------------------------

async function fetchGameList() {
  console.log('PASO 1: Obteniendo lista de juegos de game.guide...\n');
  const allGames = new Map(); // slug → { name, activeCodesCount }

  // Fetch the index page
  const { status, body } = await httpGet(`${GG_BASE}/roblox-game-codes`);
  if (status !== 200) {
    console.error(`  Error: /roblox-game-codes devolvió status ${status}`);
    return allGames;
  }

  // Extract games from RSC payload: {"id":N,"slug":"xxx","name":"Xxx","imageUrl":"...","activeCodesCount":N}
  const rscPattern = /\{"id":\d+,"slug":"([^"]+)","name":"([^"]+)","imageUrl":"[^"]*","activeCodesCount":(\d+)/g;
  let match;
  while ((match = rscPattern.exec(body)) !== null) {
    allGames.set(match[1], { name: match[2], activeCodesCount: parseInt(match[3], 10) });
  }

  // Also extract from HTML href links as fallback
  const hrefPattern = /href="\/roblox-codes\/([^"\/]+)"/g;
  while ((match = hrefPattern.exec(body)) !== null) {
    const slug = match[1];
    if (!allGames.has(slug)) {
      allGames.set(slug, { name: slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), activeCodesCount: -1 });
    }
  }

  console.log(`  Página inicial: ${allGames.size} juegos encontrados`);

  // Try pagination: attempt ?page=2, ?page=3, etc.
  // game.guide uses Next.js server actions for Load More, but some Next.js apps
  // also accept query params. We try a few pages; if they return new games, continue.
  let page = 2;
  let consecutiveEmpty = 0;
  const MAX_PAGES = 100; // Safety limit (60 per page × 100 = 6000 games max)

  while (page <= MAX_PAGES && consecutiveEmpty < 3) {
    await sleep(GG_DELAY);
    try {
      const { status: ps, body: pb } = await httpGet(`${GG_BASE}/roblox-game-codes?page=${page}`);
      if (ps !== 200) { consecutiveEmpty++; page++; continue; }

      let newFound = 0;
      const rscP = /\{"id":\d+,"slug":"([^"]+)","name":"([^"]+)","imageUrl":"[^"]*","activeCodesCount":(\d+)/g;
      while ((match = rscP.exec(pb)) !== null) {
        if (!allGames.has(match[1])) {
          allGames.set(match[1], { name: match[2], activeCodesCount: parseInt(match[3], 10) });
          newFound++;
        }
      }

      if (newFound === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        console.log(`  Página ${page}: +${newFound} juegos nuevos (total: ${allGames.size})`);
      }
    } catch {
      consecutiveEmpty++;
    }
    page++;
  }

  // Also try genre-filtered pages to discover more games
  const genres = [
    'Action', 'Adventure', 'RPG', 'Shooter', 'Strategy', 'Survival',
    'Social', 'Entertainment', 'Simulation', 'Sports+%26+Racing',
    'Obby+%26+Platformer', 'Puzzle', 'Roleplay+%26+Avatar+Sim',
  ];

  for (const genre of genres) {
    await sleep(GG_DELAY);
    try {
      const { status: gs, body: gb } = await httpGet(`${GG_BASE}/roblox-game-codes?genre=${genre}`);
      if (gs !== 200) continue;

      let newFound = 0;
      const rscG = /\{"id":\d+,"slug":"([^"]+)","name":"([^"]+)","imageUrl":"[^"]*","activeCodesCount":(\d+)/g;
      while ((match = rscG.exec(gb)) !== null) {
        if (!allGames.has(match[1])) {
          allGames.set(match[1], { name: match[2], activeCodesCount: parseInt(match[3], 10) });
          newFound++;
        }
      }
      if (newFound > 0) {
        console.log(`  Género "${genre}": +${newFound} (total: ${allGames.size})`);
      }
    } catch { /* skip */ }
  }

  console.log(`\n  Total juegos descubiertos en game.guide: ${allGames.size}\n`);
  return allGames;
}

// ---------------------------------------------------------------------------
// STEP 2: Filter new games
// ---------------------------------------------------------------------------

function getExistingSlugs() {
  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  const slugs = new Set();
  for (const f of files) {
    // Extract game slug: "codigos-blox-fruits.json" → "blox-fruits"
    const base = f.replace('.json', '');
    const gameSlug = base.replace(/^codigos?-/, '');
    slugs.add(gameSlug);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// STEP 3: Scrape codes from game.guide individual page
// ---------------------------------------------------------------------------

async function scrapeCodes(slug) {
  const url = `${GG_BASE}/roblox-codes/${slug}`;
  try {
    const { status, body } = await httpGet(url);
    if (status !== 200 || !body.includes('codes-table')) return null;

    const active = [];
    const expired = [];

    // Note: .*? between </code> and </td> to tolerate <span class="codes-new-badge">NEW</span>
    const rowPattern = /<tr\s+class="codes-table-row\s*(codes-table-row-expired)?\s*">\s*<td\s+class="codes-table-cell codes-table-code">\s*<code\s+class="codes-code-text\s*(?:codes-code-expired)?\s*">\s*([^<]+?)\s*<\/code>.*?<\/td>\s*<td\s+class="codes-table-cell codes-table-reward">\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/gs;

    let m;
    while ((m = rowPattern.exec(body)) !== null) {
      const isExpired = !!m[1];
      const code = unescapeHtml(m[2]).trim();
      const reward = m[3].trim();
      if (!code) continue;

      const entry = { code, reward: translateReward(reward) };
      if (isExpired) expired.push(entry);
      else active.push(entry);
    }

    // Deduplicate: if a code is in both active and expired, trust active
    const activeSet = new Set(active.map(c => c.code.toLowerCase()));
    const dedupedExpired = expired.filter(c => !activeSet.has(c.code.toLowerCase()));

    return { active, expired: dedupedExpired, html: body };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// STEP 4: Roblox API lookup
// ---------------------------------------------------------------------------

/**
 * Fetches Roblox data using a placeId extracted from the game.guide page HTML.
 * Pipeline: game.guide HTML → placeId → universeId → details + thumbnail
 */
async function fetchRobloxData(gameName, ggPageHtml) {
  const result = {
    placeId: null,
    universeId: null,
    thumbnail: '',
    developer: '',
    description: '',
    genre: '',
    totalVisits: 0,
    activePlayers: 0,
    likes: 0,
    favourites: 0,
  };

  // ---------------------------------------------------------------------------
  // Step A: Extract placeId from game.guide page HTML
  // game.guide embeds links like roblox.com/games/17798223108
  // ---------------------------------------------------------------------------
  const placeMatch = ggPageHtml?.match(/roblox\.com\/games\/(\d+)/);
  if (placeMatch) {
    result.placeId = parseInt(placeMatch[1], 10);
  }

  if (!result.placeId) return result;

  // ---------------------------------------------------------------------------
  // Step B: Convert placeId → universeId
  // ---------------------------------------------------------------------------
  try {
    const convUrl = `https://apis.roblox.com/universes/v1/places/${result.placeId}/universe`;
    const convRes = await httpGet(convUrl);
    if (convRes.status === 200) {
      const convData = JSON.parse(convRes.body);
      result.universeId = convData.universeId || null;
    }
  } catch { /* failed */ }

  if (!result.universeId) return result;

  await sleep(ROBLOX_DELAY);

  // ---------------------------------------------------------------------------
  // Step C: Get game details
  // ---------------------------------------------------------------------------
  try {
    const detailsUrl = `https://games.roblox.com/v1/games?universeIds=${result.universeId}`;
    const detailsRes = await httpGet(detailsUrl);

    if (detailsRes.status === 200) {
      const detailsData = JSON.parse(detailsRes.body);
      if (detailsData.data && detailsData.data[0]) {
        const d = detailsData.data[0];
        result.totalVisits = d.visits || 0;
        result.activePlayers = d.playing || 0;
        result.likes = d.totalUpVotes || 0;
        result.favourites = d.favoritedCount || 0;
        result.developer = d.creator?.name || '';
        result.description = d.description || '';
        result.genre = d.genre || '';
      }
    }
  } catch { /* use what we have */ }

  await sleep(ROBLOX_DELAY);

  // ---------------------------------------------------------------------------
  // Step D: Get thumbnail
  // ---------------------------------------------------------------------------
  try {
    const thumbUrl = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${result.universeId}&size=512x512&format=Png&isCircular=false`;
    const thumbRes = await httpGet(thumbUrl);

    if (thumbRes.status === 200) {
      const thumbData = JSON.parse(thumbRes.body);
      if (thumbData.data && thumbData.data[0]?.imageUrl) {
        result.thumbnail = thumbData.data[0].imageUrl;
      }
    }
  } catch { /* no thumbnail */ }

  return result;
}

// ---------------------------------------------------------------------------
// STEP 5: Create game JSON
// ---------------------------------------------------------------------------

function createGameJson(slug, gameName, codes, robloxData) {
  const today = new Date().toISOString().split('T')[0];
  const mesesES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const now = new Date();
  const mesAnio = `${mesesES[now.getMonth()]} ${now.getFullYear()}`;

  const fullSlug = `codigos-${slug}`;

  return {
    slug: fullSlug,
    name: gameName,
    thumbnail: robloxData.thumbnail || '',
    description: `Todos los códigos activos para ${gameName} en Roblox`,
    metaTitle: `Códigos ${gameName} Roblox (${mesAnio}) - Códigos Gratis`,
    metaDescription: codes.active.length > 0
      ? `Lista actualizada de códigos para ${gameName} en Roblox. ${codes.active.length} códigos activos. Consigue recompensas gratis.`
      : `Lista de códigos para ${gameName} en Roblox. Consulta códigos activos y expirados.`,
    lastUpdated: today,
    activeCodes: codes.active,
    expiredCodes: codes.expired,
    howToRedeem: [
      `Abre ${gameName} en Roblox`,
      'Busca el botón de códigos en el menú',
      'Escribe el código y pulsa Canjear',
    ],
    ...(robloxData.placeId && { placeId: robloxData.placeId }),
    ...(robloxData.universeId && { universeId: robloxData.universeId }),
    ...(robloxData.developer && { developer: robloxData.developer }),
    ...(robloxData.genre && { genre: robloxData.genre }),
    ...(robloxData.totalVisits && { totalVisits: robloxData.totalVisits }),
    ...(robloxData.activePlayers && { playerCount: robloxData.activePlayers }),
    ...(robloxData.likes && { likes: robloxData.likes }),
    ...(robloxData.favourites && { favourites: robloxData.favourites }),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const minCodesIdx = args.indexOf('--min-codes');
  const minCodes = minCodesIdx >= 0 ? parseInt(args[minCodesIdx + 1], 10) : 0;

  // STEP 1: Get game list from game.guide
  const ggGames = await fetchGameList();

  if (ggGames.size === 0) {
    console.error('No se encontraron juegos en game.guide. Abortando.');
    process.exit(1);
  }

  // STEP 2: Filter new games
  console.log('PASO 2: Filtrando juegos nuevos...\n');
  const existingSlugs = getExistingSlugs();
  const newGames = [];

  for (const [slug, info] of ggGames) {
    if (existingSlugs.has(slug)) continue;
    // Apply min-codes filter (skip if we know it has fewer active codes than minimum)
    if (minCodes > 0 && info.activeCodesCount >= 0 && info.activeCodesCount < minCodes) continue;
    newGames.push({ slug, ...info });
  }

  console.log(`  Juegos en game.guide: ${ggGames.size}`);
  console.log(`  Ya existentes en data/games/: ${ggGames.size - newGames.length}`);
  console.log(`  Juegos nuevos a procesar: ${newGames.length}`);
  if (minCodes > 0) console.log(`  (filtro: mínimo ${minCodes} códigos activos)`);
  console.log();

  if (newGames.length === 0) {
    console.log('No hay juegos nuevos para crear.');
    return;
  }

  // Limit
  const toProcess = newGames.slice(0, limit);
  console.log(`PASOS 3-5: Procesando ${toProcess.length} juegos nuevos...\n`);

  let created = 0;
  let errors = 0;
  const createdGames = [];

  for (let i = 0; i < toProcess.length; i++) {
    const { slug, name } = toProcess[i];

    // STEP 3: Scrape codes
    await sleep(GG_DELAY);
    const codes = await scrapeCodes(slug);

    if (!codes) {
      console.log(`  [${i + 1}/${toProcess.length}] ✗ ${name} (${slug}) — no se pudieron extraer códigos`);
      errors++;
      continue;
    }

    // Apply min-codes filter after actual scrape
    if (minCodes > 0 && codes.active.length < minCodes) {
      console.log(`  [${i + 1}/${toProcess.length}] ⊘ ${name} — solo ${codes.active.length} activos (mínimo: ${minCodes})`);
      continue;
    }

    // STEP 4: Roblox API (use placeId from game.guide HTML)
    await sleep(ROBLOX_DELAY);
    const robloxData = await fetchRobloxData(name, codes.html);

    // STEP 5: Create JSON
    const gameJson = createGameJson(slug, name, codes, robloxData);
    const filePath = path.join(GAMES_DIR, `codigos-${slug}.json`);

    if (!dryRun) {
      fs.writeFileSync(filePath, JSON.stringify(gameJson, null, 2) + '\n');
    }

    created++;
    createdGames.push({ name, slug, active: codes.active.length, expired: codes.expired.length, hasApi: !!robloxData.placeId });
    console.log(`  [${i + 1}/${toProcess.length}] ✓ ${name} (${codes.active.length} activos, ${codes.expired.length} expirados${robloxData.placeId ? ', API ✓' : ', sin API'})`);
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN');
  console.log('='.repeat(70));
  console.log(`Juegos nuevos creados: ${created}`);
  console.log(`Ya existentes (skip): ${ggGames.size - newGames.length}`);
  console.log(`Errores: ${errors}`);
  if (dryRun) console.log('\n⚠️  DRY RUN — no se crearon archivos');

  if (createdGames.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('JUEGOS CREADOS:');
    console.log(`${'─'.repeat(70)}`);
    for (const g of createdGames) {
      console.log(`  codigos-${g.slug}.json — ${g.name} (${g.active} activos, ${g.expired} expirados${g.hasApi ? '' : ', sin datos API'})`);
    }
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
