/**
 * update-codes.mjs
 *
 * Re-scrapes codes from game.guide for existing games in data/games/.
 * Replaces activeCodes and expiredCodes with fresh data.
 * Only commits if there are real changes.
 *
 * Uses a rotating batch system: processes 1500 games per run starting from
 * the last saved index (scripts/update-pointer.json). Wraps to 0 at the end.
 * Requests run concurrently (default 10) for speed.
 *
 * Usage:
 *   node scripts/update-codes.mjs [flags]
 *
 * Flags:
 *   --limit N         Override batch size (default: 1500)
 *   --dry-run         Don't write files, just show changes
 *   --fast            Use 100ms delay instead of 150ms (more aggressive)
 *   --max-minutes N   Stop after N minutes (default: 22)
 *   --concurrency N   Parallel requests (default: 10)
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const GAMES_DIR = 'data/games';
const BATCH_SIZE = 1500;
const CONCURRENCY = 10;
const MAX_RUNTIME_MS = 22 * 60 * 1000;
const POINTER_FILE = 'scripts/update-pointer.json';
const REPORT_FILE = 'scripts/update-codes-report.log';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_URL = 'https://www.game.guide/roblox-codes';

// Games to skip (not on game.guide or manually curated)
const SKIP_SLUGS = new Set([
  'codigos-afk-journey', 'codigos-cookie-run-kingdom',
  'codigos-honkai-impact', 'codigos-honkai-star-rail',
  'codigos-nba-2k-mobile', 'codigos-war-thunder',
  'codigos-echocalypse', 'codigos-super-snail',
  'codigos-black-clover-m', 'codigos-cyber-rebellion',
  'codigos-legend-of-immortals',
]);

// Slug overrides: our slug → game.guide slug
const SLUG_OVERRIDES = {
  'codigos-gpo': 'grand-piece-online',
  'codigos-tds': 'tower-defense-simulator',
  'codigos-astd': 'all-star-tower-defense',
  'codigos-mm2': 'murder-mystery-2',
  'codigos-psx': 'pet-simulator-x',
  'codigos-roblox-doors': 'doors',
  'codigos-roblox-ohio': 'ohio',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsedUrl.protocol}//${parsedUrl.hostname}${res.headers.location}`;
        return httpGet(loc).then(resolve).catch(reject);
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

function ourSlugToGGSlug(ourSlug) {
  if (SLUG_OVERRIDES.hasOwnProperty(ourSlug)) return SLUG_OVERRIDES[ourSlug];
  return ourSlug.replace(/^codigos?-/, '');
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
// Extract codes from game.guide HTML
// ---------------------------------------------------------------------------

function extractCodes(html) {
  const active = [];
  const expired = [];

  const rowPattern = /<tr\s+class="codes-table-row\s*(codes-table-row-expired)?\s*">\s*<td\s+class="codes-table-cell codes-table-code">\s*<code\s+class="codes-code-text\s*(?:codes-code-expired)?\s*">\s*([^<]+?)\s*<\/code>.*?<\/td>\s*<td\s+class="codes-table-cell codes-table-reward">\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/gs;

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const isExpired = !!match[1];
    const code = unescapeHtml(match[2]).trim();
    const reward = match[3].trim();
    if (!code) continue;

    const entry = { code, reward: translateReward(reward) };
    if (isExpired) expired.push(entry);
    else active.push(entry);
  }

  const activeSet = new Set(active.map(c => c.code.toLowerCase()));
  const dedupedExpired = expired.filter(c => !activeSet.has(c.code.toLowerCase()));

  return { active, expired: dedupedExpired };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fast = args.includes('--fast');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : BATCH_SIZE;
  const concIdx = args.indexOf('--concurrency');
  const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : CONCURRENCY;
  const maxMinIdx = args.indexOf('--max-minutes');
  const maxRuntimeMs = maxMinIdx >= 0 ? parseInt(args[maxMinIdx + 1], 10) * 60 * 1000 : MAX_RUNTIME_MS;
  const delayMs = fast ? 100 : 150;

  const deadline = Date.now() + maxRuntimeMs;

  // Load all game files
  const allFiles = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  const total = allFiles.length;

  // Read batch pointer
  let lastIndex = 0;
  try {
    const pointer = JSON.parse(fs.readFileSync(POINTER_FILE, 'utf-8'));
    lastIndex = pointer.lastIndex || 0;
  } catch {}
  if (lastIndex >= total) lastIndex = 0;

  const startIdx = lastIndex;
  const endIdx = Math.min(startIdx + limit, total);
  const files = allFiles.slice(startIdx, endIdx);

  console.log(`Procesando juegos [${startIdx}] a [${endIdx - 1}] de [${total}]`);
  console.log(`Concurrencia: ${concurrency} | Delay: ${delayMs}ms${fast ? ' (fast)' : ''} | Timeout: ${Math.round(maxRuntimeMs / 60000)}min`);
  if (dryRun) console.log('MODO: DRY RUN');
  console.log();

  let processed = 0;
  let updated = 0;
  let noChange = 0;
  let notFound = 0;
  let skipped = 0;
  let totalNewActive = 0;
  let totalMovedExpired = 0;
  let timedOut = false;
  const changes = [];

  // Shared index for the worker pool (JS is single-threaded, so this is safe)
  let nextFileIdx = 0;
  // Track how far we actually got for the pointer
  let maxClaimedIdx = 0;

  // Process a single game file — called by each worker
  async function processGame(file) {
    const filePath = path.join(GAMES_DIR, file);
    const game = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Skip non-Roblox or no-code games
    if (game.noCodeSystem || SKIP_SLUGS.has(game.slug)) {
      skipped++;
      return;
    }

    const ggSlug = ourSlugToGGSlug(game.slug);
    if (!ggSlug) { skipped++; return; }

    processed++;

    // Fetch page
    let html;
    try {
      const { status, body } = await httpGet(`${BASE_URL}/${ggSlug}`);
      if (status !== 200 || !body.includes('codes-table')) {
        notFound++;
        return;
      }
      html = body;
    } catch {
      notFound++;
      return;
    }

    // Extract codes
    const gg = extractCodes(html);

    // Skip empty pages (avoid wiping data)
    if (gg.active.length === 0 && gg.expired.length === 0) {
      notFound++;
      return;
    }

    const activeBefore = (game.activeCodes || []).length;
    const expiredBefore = (game.expiredCodes || []).length;

    // Build merged expired list
    const ggActiveSet = new Set(gg.active.map(c => c.code.toLowerCase()));
    const seenExpired = new Set();
    const mergedExpired = [];

    const addExpired = (code, reward) => {
      const key = code.toLowerCase();
      if (seenExpired.has(key) || ggActiveSet.has(key)) return;
      seenExpired.add(key);
      mergedExpired.push({ code, reward });
    };

    for (const c of (game.activeCodes || [])) {
      if (!ggActiveSet.has(c.code.toLowerCase())) addExpired(c.code, c.reward);
    }
    for (const c of gg.expired) addExpired(c.code, c.reward);
    for (const c of (game.expiredCodes || [])) addExpired(c.code, c.reward);

    const activeAfter = gg.active.length;
    const expiredAfter = mergedExpired.length;

    // Check if anything changed
    const oldActiveStr = JSON.stringify((game.activeCodes || []).map(c => c.code.toLowerCase()).sort());
    const newActiveStr = JSON.stringify(gg.active.map(c => c.code.toLowerCase()).sort());
    const oldExpiredStr = JSON.stringify((game.expiredCodes || []).map(c => c.code.toLowerCase()).sort());
    const newExpiredStr = JSON.stringify(mergedExpired.map(c => c.code.toLowerCase()).sort());

    if (oldActiveStr === newActiveStr && oldExpiredStr === newExpiredStr) {
      noChange++;
      if (processed % 100 === 0) console.log(`  [${processed}] ...`);
      return;
    }

    const oldActiveSet = new Set((game.activeCodes || []).map(c => c.code.toLowerCase()));
    const oldActiveMap = new Map((game.activeCodes || []).map(c => [c.code.toLowerCase(), c]));
    const today = new Date().toISOString().split('T')[0];

    for (const c of gg.active) {
      const old = oldActiveMap.get(c.code.toLowerCase());
      if (old && old.addedDate) {
        c.addedDate = old.addedDate;
      } else if (!oldActiveSet.has(c.code.toLowerCase())) {
        c.addedDate = today;
      }
    }

    game.activeCodes = gg.active;
    game.expiredCodes = mergedExpired;
    game.lastUpdated = today;

    if (activeAfter > 0) {
      const mesesES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const now = new Date();
      const mesAnio = `${mesesES[now.getMonth()]} ${now.getFullYear()}`;
      game.metaTitle = `Códigos ${game.name} Roblox (${mesAnio}) - Códigos Gratis`;
      game.metaDescription = `Lista actualizada de códigos para ${game.name} en Roblox. ${activeAfter} códigos activos. Consigue recompensas gratis.`;
    }

    if (!dryRun) {
      fs.writeFileSync(filePath, JSON.stringify(game, null, 2) + '\n');
    }

    updated++;

    const newCodes = gg.active.filter(c => !oldActiveSet.has(c.code.toLowerCase()));
    const movedToExpired = activeBefore - activeAfter;
    if (movedToExpired > 0) totalMovedExpired += movedToExpired;
    totalNewActive += newCodes.length;

    const delta = activeAfter - activeBefore;
    const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
    console.log(`  ${game.name}: ${activeBefore}→${activeAfter} activos (${arrow}), ${expiredBefore}→${expiredAfter} exp`);

    changes.push({
      name: game.name,
      activeBefore, activeAfter,
      expiredBefore, expiredAfter,
      newCodes: newCodes.map(c => c.code),
    });
  }

  // Concurrent worker pool
  async function worker() {
    while (true) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      const i = nextFileIdx++;
      if (i >= files.length) break;
      if (i > maxClaimedIdx) maxClaimedIdx = i;
      await sleep(delayMs);
      await processGame(files[i]);
    }
  }

  const startTime = Date.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Save pointer: advance to where we actually got
  const gamesProcessed = Math.min(maxClaimedIdx + 1, files.length);
  const newIndex = startIdx + gamesProcessed >= total ? 0 : startIdx + gamesProcessed;
  if (!dryRun) {
    fs.writeFileSync(POINTER_FILE, JSON.stringify({ lastIndex: newIndex }, null, 2) + '\n');
    console.log(`\nPuntero guardado: ${newIndex} (siguiente lote empieza en ${newIndex})`);
  }

  if (timedOut) {
    console.log(`\n⏱ TIME GUARD: parado tras ${elapsed}s (límite ${Math.round(maxRuntimeMs / 60000)}min). Procesados ${gamesProcessed} de ${files.length}.`);
  }

  console.log(`\nActualizados: ${updated}, Códigos nuevos: ${totalNewActive}, Errores: ${notFound} (${elapsed}s)`);

  // Report
  console.log('\n' + '='.repeat(70));
  console.log('INFORME DE ACTUALIZACIÓN');
  console.log('='.repeat(70));
  console.log(`Procesados:    ${processed}`);
  console.log(`Actualizados:  ${updated}`);
  console.log(`Sin cambios:   ${noChange}`);
  console.log(`No encontrado: ${notFound}`);
  console.log(`Saltados:      ${skipped}`);
  console.log(`Tiempo:        ${elapsed}s`);
  if (timedOut) console.log(`TIMEOUT:       sí (procesados ${gamesProcessed}/${files.length})`);
  if (dryRun) console.log('\nDRY RUN — no se escribieron cambios');

  if (changes.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('CAMBIOS DETALLADOS:');
    console.log(`${'─'.repeat(70)}`);
    for (const c of changes) {
      const delta = c.activeAfter - c.activeBefore;
      console.log(`  ${c.name}: ${c.activeBefore}→${c.activeAfter} activos, ${c.expiredBefore}→${c.expiredAfter} expirados`);
      if (c.newCodes.length > 0) {
        console.log(`    Nuevos: ${c.newCodes.join(', ')}`);
      }
    }

    console.log(`\n${'─'.repeat(70)}`);
    console.log('RESUMEN DE CAMBIOS:');
    console.log(`  Juegos actualizados: ${updated}`);
    console.log(`  Códigos nuevos descubiertos: ${totalNewActive}`);
    console.log(`  Códigos movidos a expirados: ${totalMovedExpired}`);
  } else {
    console.log('\nTodos los juegos están al día.');
  }

  // Write report file for status page
  if (!dryRun) {
    const lines = [];
    lines.push(`Lote: [${startIdx}] a [${startIdx + gamesProcessed - 1}] de [${total}]`);
    lines.push(`Procesados: ${processed} | Actualizados: ${updated} | Sin cambios: ${noChange}`);
    lines.push(`No encontrado: ${notFound} | Saltados: ${skipped}`);
    lines.push(`Códigos nuevos: ${totalNewActive} | Movidos a expirados: ${totalMovedExpired}`);
    lines.push(`Tiempo: ${elapsed}s | Concurrencia: ${concurrency}`);
    if (timedOut) lines.push(`TIMEOUT: procesados ${gamesProcessed}/${files.length}`);
    if (changes.length > 0) {
      lines.push('');
      lines.push('Juegos actualizados:');
      for (const c of changes) {
        const delta = c.activeAfter - c.activeBefore;
        const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
        lines.push(`  ${c.name}: ${c.activeBefore}→${c.activeAfter} activos (${arrow}), ${c.expiredBefore}→${c.expiredAfter} exp`);
        if (c.newCodes.length > 0) {
          lines.push(`    Nuevos: ${c.newCodes.join(', ')}`);
        }
      }
    }
    fs.writeFileSync(REPORT_FILE, lines.join('\n') + '\n');
    console.log(`\nReporte guardado en ${REPORT_FILE}`);
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
