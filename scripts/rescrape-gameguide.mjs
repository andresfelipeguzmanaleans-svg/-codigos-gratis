/**
 * rescrape-gameguide.mjs
 * Re-scrapes codes using game.guide as primary source.
 * game.guide has clearly separated Active/Expired sections with daily verification.
 *
 * HTML structure:
 *   Active:  <tr class="codes-table-row "><td ...><code class="codes-code-text ">CODE</code></td>
 *            <td ...><span class="">REWARD</span>...</td></tr>
 *   Expired: <tr class="codes-table-row codes-table-row-expired"><td ...><code class="codes-code-text codes-code-expired">CODE</code></td>
 *            <td ...><span class="text-muted-foreground">REWARD</span>...</td></tr>
 *
 * URL pattern: https://www.game.guide/roblox-codes/{slug}
 *
 * Usage: node scripts/rescrape-gameguide.mjs [--limit N] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

const GAMES_DIR = 'data/games';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DELAY_MS = 800;
const BASE_URL = 'https://www.game.guide/roblox-codes';

// Games manually verified — compare but don't overwrite
const COMPARE_ONLY = new Set(['codigos-blox-fruits', 'codigos-da-hood']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': UA },
      timeout: 15000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : 'https://www.game.guide' + res.headers.location;
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

async function fetchPage(url) {
  try {
    const { status, body } = await httpGet(url);
    if (status === 404) return null;
    if (status !== 200) return null;
    // Check for soft 404
    if (body.includes('page could not be found') || body.includes('This page doesn')) return null;
    // Must have the codes table
    if (!body.includes('codes-table')) return null;
    return body;
  } catch {
    return null;
  }
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8230;/g, '…')
    .replace(/&#x27;/g, "'").replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Slug mapping: our slug → game.guide slug
// ---------------------------------------------------------------------------

// Special overrides where our slug doesn't match game.guide's
const SLUG_OVERRIDES = {
  'codigos-gpo': 'grand-piece-online',
  'codigos-tds': 'tower-defense-simulator',
  'codigos-astd': 'all-star-tower-defense',
  'codigos-mm2': 'murder-mystery-2',
  'codigos-psx': 'pet-simulator-x',
  'codigos-roblox-doors': 'doors',
  'codigos-roblox-ohio': 'ohio',
  'codigos-afk-journey': null,            // Not Roblox
  'codigos-cookie-run-kingdom': null,      // Not Roblox
  'codigos-honkai-impact': null,           // Not Roblox
  'codigos-honkai-star-rail': null,        // Not Roblox
  'codigos-nba-2k-mobile': null,           // Not Roblox
  'codigos-war-thunder': null,             // Not Roblox
  'codigos-echocalypse': null,             // Not Roblox
  'codigos-super-snail': null,             // Not Roblox
  'codigos-black-clover-m': null,          // Not Roblox
  'codigos-cyber-rebellion': null,         // Not Roblox
  'codigos-legend-of-immortals': null,     // Not Roblox
};

function ourSlugToGGSlug(ourSlug) {
  // Check overrides first
  if (SLUG_OVERRIDES.hasOwnProperty(ourSlug)) return SLUG_OVERRIDES[ourSlug];
  // Strip "codigos-" or "codigo-" prefix
  return ourSlug.replace(/^codigos?-/, '');
}

// ---------------------------------------------------------------------------
// Reward translation (EN → ES)
// ---------------------------------------------------------------------------

const PHRASE_MAP = {
  'redeem this code for a': '',
  'redeem this code to get a': '',
  'redeem this code to get': '',
  'redeem this code for': '',
  'redeem this code to': '',
  'redeem for a': '',
  'redeem for': '',
  'free stat reset': 'reinicio de stats gratis',
  'stat reset': 'reinicio de stats',
  'stat refund': 'reinicio de stats',
  'stat points reset': 'reinicio de stats',
  'reset your stats': 'reiniciar tus stats',
  'in-game title': 'título del juego',
  'double xp': '2x EXP',
  '2x xp': '2x EXP',
  '2x exp': '2x EXP',
  '3x xp': '3x EXP',
  '2x experience': '2x experiencia',
  '2x coins': '2x monedas',
  'triple coins': 'triple monedas',
  'expired reward': 'Recompensa expirada',
  'freebies': 'Recompensas gratis',
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
  'crate': 'cofre', 'crates': 'cofres',
  'chest': 'cofre', 'chests': 'cofres',
  'key': 'llave', 'keys': 'llaves',
  'reward': 'recompensa', 'rewards': 'recompensas',
  'item': 'objeto', 'items': 'objetos',
  'title': 'título', 'potion': 'poción', 'potions': 'pociones',
  'ticket': 'ticket', 'tickets': 'tickets',
  'spin': 'giro', 'spins': 'giros',
  'roll': 'tirada', 'rolls': 'tiradas',
  'summon': 'invocación', 'summons': 'invocaciones',
  'strength': 'fuerza', 'speed': 'velocidad',
  'damage': 'daño', 'experience': 'experiencia',
  'gift': 'regalo', 'luck': 'suerte',
  'limited': 'limitado', 'exclusive': 'exclusivo',
  'special': 'especial', 'rare': 'raro',
  'legendary': 'legendario', 'arrows': 'flechas', 'arrow': 'flecha',
  'revive': 'revivir', 'revives': 'revividas',
  'pushes': 'empujones', 'push': 'empujón',
  'weapon': 'arma', 'weapons': 'armas',
};

function translateReward(text) {
  if (!text) return 'Recompensa gratis';
  let result = unescapeHtml(text).trim();

  // Remove (NEW) / (New) markers
  result = result.replace(/\s*\(NEW\)\s*/gi, '').trim();

  // Phrase replacements first (including "Redeem this code..." prefix stripping)
  for (const [en, es] of Object.entries(PHRASE_MAP)) {
    const regex = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, es);
  }

  // Clean up after prefix stripping
  result = result.replace(/^\s*[,.:;–—-]\s*/, '').trim();

  // "Free X" → "X gratis"
  result = result.replace(/\bFree\s+(.+)/i, (_, rest) => rest.trim() + ' gratis');

  // Word-level replacements
  for (const [en, es] of Object.entries(WORD_MAP)) {
    const regex = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, es);
  }

  // "gratis gratis" → "gratis"
  result = result.replace(/gratis\s+gratis/gi, 'gratis');

  // Capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  // Remove trailing periods, brackets
  result = result.replace(/\.\s*$/, '').replace(/\s*\[.*$/, '').trim();

  // If empty after all processing, default
  if (!result || result.length < 2) result = 'Recompensa gratis';

  return result;
}

// ---------------------------------------------------------------------------
// game.guide HTML extraction
// ---------------------------------------------------------------------------

function extractCodes(html) {
  const active = [];
  const expired = [];

  // Pattern matches both active and expired rows
  // Active:  <tr class="codes-table-row ">
  // Expired: <tr class="codes-table-row codes-table-row-expired">
  // Note: .*? between </code> and </td> to tolerate <span class="codes-new-badge">NEW</span>
  const rowPattern = /<tr\s+class="codes-table-row\s*(codes-table-row-expired)?\s*">\s*<td\s+class="codes-table-cell codes-table-code">\s*<code\s+class="codes-code-text\s*(?:codes-code-expired)?\s*">\s*([^<]+?)\s*<\/code>.*?<\/td>\s*<td\s+class="codes-table-cell codes-table-reward">\s*<span[^>]*>\s*([^<]*?)\s*<\/span>/gs;

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const isExpired = !!match[1];
    const code = unescapeHtml(match[2]).trim();
    const reward = match[3].trim();

    if (!code) continue;

    const entry = { code, reward: translateReward(reward) };

    if (isExpired) {
      expired.push(entry);
    } else {
      active.push(entry);
    }
  }

  // Deduplicate (same code appearing in both active and expired — trust active)
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
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

  // Load all game JSONs
  const files = fs.readdirSync(GAMES_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} game files\n`);

  const report = [];
  let updated = 0;
  let notFound = 0;
  let skipped = 0;
  let compareOnly = 0;
  let noChange = 0;
  let processed = 0;

  for (const file of files) {
    if (processed >= limit) break;

    const filePath = path.join(GAMES_DIR, file);
    const game = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const ourSlug = game.slug;

    // Skip games without code system
    if (game.noCodeSystem) {
      skipped++;
      continue;
    }

    // Map to game.guide slug
    const ggSlug = ourSlugToGGSlug(ourSlug);
    if (ggSlug === null) {
      skipped++;
      continue;
    }

    processed++;
    const url = `${BASE_URL}/${ggSlug}`;

    // Fetch page
    const html = await fetchPage(url);

    if (!html) {
      notFound++;
      report.push({
        game: game.name,
        slug: ourSlug,
        ggSlug,
        status: 'NOT FOUND',
        activeBefore: (game.activeCodes || []).length,
        activeAfter: (game.activeCodes || []).length,
        expiredBefore: (game.expiredCodes || []).length,
        expiredAfter: (game.expiredCodes || []).length,
      });
      if (processed % 20 === 0) console.log(`[${processed}/${Math.min(files.length, limit)}] ...`);
      await sleep(DELAY_MS);
      continue;
    }

    // Extract codes from game.guide
    const gg = extractCodes(html);
    const activeBefore = (game.activeCodes || []).length;
    const expiredBefore = (game.expiredCodes || []).length;

    // Compare-only for manually verified games
    if (COMPARE_ONLY.has(ourSlug)) {
      compareOnly++;
      const diff = {
        game: game.name,
        slug: ourSlug,
        ggSlug,
        status: 'COMPARE ONLY',
        activeBefore,
        activeAfter: activeBefore,
        expiredBefore,
        expiredAfter: expiredBefore,
        ggActive: gg.active.length,
        ggExpired: gg.expired.length,
        ggActiveCodes: gg.active.map(c => c.code),
      };
      report.push(diff);
      console.log(`  [COMPARE] ${game.name}: ours ${activeBefore} active, game.guide ${gg.active.length} active`);
      if (gg.active.length > 0) {
        console.log(`    game.guide active: ${gg.active.map(c => c.code).join(', ')}`);
      }
      await sleep(DELAY_MS);
      continue;
    }

    // If game.guide has no data at all (0 active, 0 expired), skip to avoid wiping data
    if (gg.active.length === 0 && gg.expired.length === 0) {
      notFound++;
      report.push({
        game: game.name,
        slug: ourSlug,
        ggSlug,
        status: 'EMPTY PAGE',
        activeBefore,
        activeAfter: activeBefore,
        expiredBefore,
        expiredAfter: expiredBefore,
      });
      await sleep(DELAY_MS);
      continue;
    }

    // Build merged expired list:
    // 1. All codes from game.guide's expired section
    // 2. Our previous active codes that are NOT in game.guide's active list
    // 3. Our previous expired codes
    // Deduplicate by code (case-insensitive)

    const ggActiveSet = new Set(gg.active.map(c => c.code.toLowerCase()));
    const seenExpired = new Set();
    const mergedExpired = [];

    function addExpired(code, reward) {
      const key = code.toLowerCase();
      if (seenExpired.has(key)) return;
      seenExpired.add(key);
      mergedExpired.push({ code, reward });
    }

    // Our old active codes that game.guide doesn't list as active → expired
    for (const c of (game.activeCodes || [])) {
      if (!ggActiveSet.has(c.code.toLowerCase())) {
        addExpired(c.code, c.reward);
      }
    }

    // game.guide expired codes
    for (const c of gg.expired) {
      addExpired(c.code, c.reward);
    }

    // Our old expired codes
    for (const c of (game.expiredCodes || [])) {
      addExpired(c.code, c.reward);
    }

    // Remove from expired any that are in game.guide's active
    const finalExpired = mergedExpired.filter(c => !ggActiveSet.has(c.code.toLowerCase()));

    const activeAfter = gg.active.length;
    const expiredAfter = finalExpired.length;

    // Check if anything actually changed
    const oldActiveStr = JSON.stringify((game.activeCodes || []).map(c => c.code.toLowerCase()).sort());
    const newActiveStr = JSON.stringify(gg.active.map(c => c.code.toLowerCase()).sort());
    if (oldActiveStr === newActiveStr && expiredAfter === expiredBefore) {
      noChange++;
      report.push({
        game: game.name,
        slug: ourSlug,
        ggSlug,
        status: 'NO CHANGE',
        activeBefore,
        activeAfter,
        expiredBefore,
        expiredAfter,
      });
      await sleep(DELAY_MS);
      continue;
    }

    // Apply changes
    game.activeCodes = gg.active;
    game.expiredCodes = finalExpired;
    game.lastUpdated = new Date().toISOString().split('T')[0];

    if (!dryRun) {
      fs.writeFileSync(filePath, JSON.stringify(game, null, 2) + '\n');
    }

    updated++;
    const movedToExpired = activeBefore - activeAfter;
    report.push({
      game: game.name,
      slug: ourSlug,
      ggSlug,
      status: movedToExpired > 0 ? 'CLEANED' : (activeAfter > activeBefore ? 'ADDED' : 'UPDATED'),
      activeBefore,
      activeAfter,
      expiredBefore,
      expiredAfter,
    });

    const arrow = activeAfter < activeBefore ? '↓' : (activeAfter > activeBefore ? '↑' : '=');
    console.log(`  ${game.name}: ${activeBefore} → ${activeAfter} active ${arrow} (expired: ${expiredBefore} → ${expiredAfter})`);

    await sleep(DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log('\n' + '='.repeat(70));
  console.log('INFORME FINAL');
  console.log('='.repeat(70));
  console.log(`Total procesados: ${processed}`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Sin cambios: ${noChange}`);
  console.log(`No encontrados: ${notFound}`);
  console.log(`Saltados (no-Roblox / noCodeSystem): ${skipped}`);
  console.log(`Solo comparación (Blox Fruits, Da Hood): ${compareOnly}`);

  if (dryRun) console.log('\n⚠️  DRY RUN — no se escribieron cambios');

  // Detailed changes
  const changes = report.filter(r => r.status === 'CLEANED' || r.status === 'ADDED' || r.status === 'UPDATED');
  if (changes.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('CAMBIOS DETALLADOS:');
    console.log(`${'─'.repeat(70)}`);
    for (const r of changes) {
      console.log(`  ${r.game}: activos ${r.activeBefore} → ${r.activeAfter}, expirados ${r.expiredBefore} → ${r.expiredAfter}`);
    }
  }

  // Not found
  const nf = report.filter(r => r.status === 'NOT FOUND' || r.status === 'EMPTY PAGE');
  if (nf.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`NO ENCONTRADOS EN GAME.GUIDE (${nf.length}):`);
    console.log(`${'─'.repeat(70)}`);
    for (const r of nf) {
      console.log(`  ${r.game} (tried: ${r.ggSlug})`);
    }
  }

  // Compare only
  const cmp = report.filter(r => r.status === 'COMPARE ONLY');
  if (cmp.length > 0) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log('COMPARACIÓN (no sobrescritos):');
    console.log(`${'─'.repeat(70)}`);
    for (const r of cmp) {
      console.log(`  ${r.game}: nuestros ${r.activeBefore} activos vs game.guide ${r.ggActive} activos`);
      if (r.ggActiveCodes && r.ggActiveCodes.length > 0) {
        console.log(`    game.guide activos: ${r.ggActiveCodes.join(', ')}`);
      }
    }
  }

  // Summary stats
  const totalActivesBefore = report.reduce((s, r) => s + r.activeBefore, 0);
  const totalActivesAfter = report.reduce((s, r) => s + r.activeAfter, 0);
  const totalExpiredBefore = report.reduce((s, r) => s + r.expiredBefore, 0);
  const totalExpiredAfter = report.reduce((s, r) => s + r.expiredAfter, 0);

  console.log(`\n${'─'.repeat(70)}`);
  console.log('TOTALES:');
  console.log(`  Activos: ${totalActivesBefore} → ${totalActivesAfter} (${totalActivesAfter - totalActivesBefore >= 0 ? '+' : ''}${totalActivesAfter - totalActivesBefore})`);
  console.log(`  Expirados: ${totalExpiredBefore} → ${totalExpiredAfter} (${totalExpiredAfter - totalExpiredBefore >= 0 ? '+' : ''}${totalExpiredAfter - totalExpiredBefore})`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
