/**
 * scrape-all-new-games.mjs
 *
 * Batch scraper: reads data/gameguide-urls.json, processes entries with
 * scraped:false, creates game JSONs (codes + Roblox API), and marks them
 * scraped:true. Auto-commits every 500 games.
 *
 * Usage:
 *   node scripts/scrape-all-new-games.mjs [flags]
 *
 * Flags:
 *   --limit N      Only process N games (default: all)
 *   --offset N     Skip first N unscraped games (default: 0)
 *   --dry-run      Don't write files, just show what would be created
 *   --min-codes N  Only create games with at least N active codes (default: 0)
 *   --resume       Alias for default behavior (always resumes from scraped:false)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';

const GAMES_DIR = 'data/games';
const URLS_FILE = 'data/gameguide-urls.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const GG_DELAY = 2000;
const ROBLOX_DELAY = 1000;
const COMMIT_EVERY = 500;

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
// Reward translation (EN → ES)
// ---------------------------------------------------------------------------

const PHRASE_MAP = {
  'redeem this code for a': '', 'redeem this code to get a': '',
  'redeem this code to get': '', 'redeem this code for': '',
  'redeem this code to': '', 'redeem for a': '', 'redeem for': '',
  'redeem code for': '', 'redeem code to get': '',
  'free stat reset': 'reinicio de stats gratis',
  'stat reset': 'reinicio de stats', 'stat refund': 'reinicio de stats',
  'stat points reset': 'reinicio de stats',
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
// Scrape codes from game.guide page
// ---------------------------------------------------------------------------

async function scrapeCodes(slug) {
  const url = `https://www.game.guide/roblox-codes/${slug}`;
  try {
    const { status, body } = await httpGet(url);
    if (status !== 200 || !body.includes('codes-table')) return null;

    const active = [];
    const expired = [];

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

    const activeSet = new Set(active.map(c => c.code.toLowerCase()));
    const dedupedExpired = expired.filter(c => !activeSet.has(c.code.toLowerCase()));

    return { active, expired: dedupedExpired, html: body };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Roblox API lookup
// ---------------------------------------------------------------------------

async function fetchRobloxData(gameName, ggPageHtml) {
  const result = {
    placeId: null, universeId: null, thumbnail: '',
    developer: '', genre: '', totalVisits: 0,
    activePlayers: 0, favourites: 0,
  };

  const placeMatch = ggPageHtml?.match(/roblox\.com\/games\/(\d+)/);
  if (placeMatch) result.placeId = parseInt(placeMatch[1], 10);
  if (!result.placeId) return result;

  try {
    const convRes = await httpGet(`https://apis.roblox.com/universes/v1/places/${result.placeId}/universe`);
    if (convRes.status === 200) {
      result.universeId = JSON.parse(convRes.body).universeId || null;
    }
  } catch { /* */ }

  if (!result.universeId) return result;
  await sleep(ROBLOX_DELAY);

  try {
    const detRes = await httpGet(`https://games.roblox.com/v1/games?universeIds=${result.universeId}`);
    if (detRes.status === 200) {
      const d = JSON.parse(detRes.body).data?.[0];
      if (d) {
        result.totalVisits = d.visits || 0;
        result.activePlayers = d.playing || 0;
        result.favourites = d.favoritedCount || 0;
        result.developer = d.creator?.name || '';
        result.genre = d.genre || '';
      }
    }
  } catch { /* */ }

  await sleep(ROBLOX_DELAY);

  try {
    const thumbRes = await httpGet(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${result.universeId}&size=512x512&format=Png&isCircular=false`);
    if (thumbRes.status === 200) {
      const img = JSON.parse(thumbRes.body).data?.[0]?.imageUrl;
      if (img) result.thumbnail = img;
    }
  } catch { /* */ }

  return result;
}

// ---------------------------------------------------------------------------
// Create game JSON (NO SEO text fields — template generates fallbacks)
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
    ...(robloxData.favourites && { favourites: robloxData.favourites }),
  };
}

// ---------------------------------------------------------------------------
// Auto commit + push
// ---------------------------------------------------------------------------

function autoCommit(count, totalCreated) {
  try {
    execSync('git add data/games/ data/gameguide-urls.json', { stdio: 'pipe' });
    execSync(`git commit -m "Add ${count} new game JSONs (batch, total: ${totalCreated})"`, { stdio: 'pipe' });
    execSync('git push', { stdio: 'pipe', timeout: 30000 });
    console.log(`\n  >>> AUTO-COMMIT + PUSH: ${count} juegos en este batch (${totalCreated} total) <<<\n`);
    return true;
  } catch (err) {
    console.log(`\n  >>> COMMIT FALLIDO: ${err.message} <<<\n`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1], 10) : 0;
  const minCodesIdx = args.indexOf('--min-codes');
  const minCodes = minCodesIdx >= 0 ? parseInt(args[minCodesIdx + 1], 10) : 0;

  // Read URL catalog
  if (!fs.existsSync(URLS_FILE)) {
    console.error(`Error: ${URLS_FILE} no encontrado. Ejecuta primero discover-new-games.mjs.`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(URLS_FILE, 'utf-8'));
  const unscraped = catalog.filter(g => !g.scraped);

  console.log(`Catálogo: ${catalog.length} juegos (${catalog.length - unscraped.length} scraped, ${unscraped.length} pendientes)\n`);

  if (unscraped.length === 0) {
    console.log('Todos los juegos ya están scraped. Nada que hacer.');
    return;
  }

  // Apply offset + limit
  const toProcess = unscraped.slice(offset, offset + limit);
  console.log(`Procesando: ${toProcess.length} juegos (offset=${offset}, limit=${limit === Infinity ? 'all' : limit})`);
  if (minCodes > 0) console.log(`Filtro: mínimo ${minCodes} códigos activos`);
  if (dryRun) console.log('MODO: DRY RUN — no se crearán archivos\n');
  else console.log();

  // Build index for fast lookup to mark scraped:true
  const catalogIndex = new Map();
  catalog.forEach((g, i) => catalogIndex.set(g.slug, i));

  let created = 0;
  let errors = 0;
  let skippedMinCodes = 0;
  let batchCount = 0;
  const createdGames = [];
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i++) {
    const { slug, name } = toProcess[i];

    // Safety: skip if file already exists
    if (fs.existsSync(path.join(GAMES_DIR, `codigos-${slug}.json`))) {
      // Mark as scraped even if it exists
      const idx = catalogIndex.get(slug);
      if (idx !== undefined) catalog[idx].scraped = true;
      continue;
    }

    // Scrape codes
    await sleep(GG_DELAY);
    const codes = await scrapeCodes(slug);

    if (!codes) {
      console.log(`  [${i + 1}/${toProcess.length}] ✗ ${name} — sin tabla de códigos`);
      errors++;
      // Mark as scraped so we don't retry failures forever
      const idx = catalogIndex.get(slug);
      if (idx !== undefined) catalog[idx].scraped = true;
      if (!dryRun) fs.writeFileSync(URLS_FILE, JSON.stringify(catalog, null, 2) + '\n');
      continue;
    }

    // Min-codes filter
    if (minCodes > 0 && codes.active.length < minCodes) {
      console.log(`  [${i + 1}/${toProcess.length}] ⊘ ${name} — ${codes.active.length} activos (mín: ${minCodes})`);
      skippedMinCodes++;
      const idx = catalogIndex.get(slug);
      if (idx !== undefined) catalog[idx].scraped = true;
      if (!dryRun) fs.writeFileSync(URLS_FILE, JSON.stringify(catalog, null, 2) + '\n');
      continue;
    }

    // Roblox API
    await sleep(ROBLOX_DELAY);
    const robloxData = await fetchRobloxData(name, codes.html);

    // Create JSON
    const gameJson = createGameJson(slug, name, codes, robloxData);
    const filePath = path.join(GAMES_DIR, `codigos-${slug}.json`);

    if (!dryRun) {
      fs.writeFileSync(filePath, JSON.stringify(gameJson, null, 2) + '\n');
    }

    // Mark scraped
    const idx = catalogIndex.get(slug);
    if (idx !== undefined) catalog[idx].scraped = true;
    if (!dryRun) fs.writeFileSync(URLS_FILE, JSON.stringify(catalog, null, 2) + '\n');

    created++;
    batchCount++;

    createdGames.push({
      name, slug,
      active: codes.active.length,
      expired: codes.expired.length,
      hasApi: !!robloxData.placeId,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`  [${i + 1}/${toProcess.length}] ✓ ${name} (${codes.active.length}A/${codes.expired.length}E${robloxData.placeId ? ' API✓' : ''}) [${elapsed}s]`);

    // Auto commit+push every COMMIT_EVERY games
    if (!dryRun && batchCount >= COMMIT_EVERY) {
      autoCommit(batchCount, created);
      batchCount = 0;
    }
  }

  // Final commit for remaining games
  if (!dryRun && batchCount > 0) {
    autoCommit(batchCount, created);
  }

  // Report
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(70));
  console.log('RESUMEN');
  console.log('='.repeat(70));
  console.log(`Creados: ${created}`);
  console.log(`Errores (sin tabla): ${errors}`);
  if (skippedMinCodes > 0) console.log(`Omitidos (pocos códigos): ${skippedMinCodes}`);
  console.log(`Tiempo: ${totalElapsed}s`);
  if (dryRun) console.log('\nDRY RUN — no se crearon archivos');

  if (createdGames.length > 0) {
    const totalActive = createdGames.reduce((s, g) => s + g.active, 0);
    const totalExpired = createdGames.reduce((s, g) => s + g.expired, 0);
    const withApi = createdGames.filter(g => g.hasApi).length;
    console.log(`\nTotal códigos: ${totalActive} activos, ${totalExpired} expirados`);
    console.log(`Con datos Roblox API: ${withApi}/${created}`);

    console.log(`\n${'─'.repeat(70)}`);
    for (const g of createdGames) {
      console.log(`  codigos-${g.slug}.json — ${g.name} (${g.active}A/${g.expired}E${g.hasApi ? '' : ' sin-API'})`);
    }
  }

  // Final catalog stats
  const finalScraped = catalog.filter(g => g.scraped).length;
  console.log(`\nCatálogo: ${finalScraped}/${catalog.length} scraped`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
