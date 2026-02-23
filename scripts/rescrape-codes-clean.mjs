/**
 * rescrape-codes-clean.mjs
 * Re-scrapes codes using Pro Game Guides (primary) and TryHardGuides (backup).
 * REPLACES all active codes (not merge) to eliminate false actives.
 *
 * PGG has two formats:
 *   - New table: <span class="code-text">CODE</span> + <span class="description-text">REWARD</span>
 *   - Old list:  <li><strong>CODE</strong> – Reward</li> with Working/Expired headings
 *
 * Usage: node scripts/rescrape-codes-clean.mjs [--limit N] [--all] [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const GAMES_DIR = 'data/games';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DELAY_MS = 1200;

// Games already manually verified — skip them
const SKIP_SLUGS = new Set(['codigos-blox-fruits', 'codigos-da-hood']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function slugVariations(name) {
  const base = nameToSlug(name);
  const variants = [base];
  if (base.startsWith('roblox-')) variants.push(base.slice(7));
  if (base.includes('simulator')) variants.push(base.replace('simulator', 'sim'));
  return [...new Set(variants)];
}

async function fetchHtml(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (res.status !== 200) return null;
    const html = await res.text();
    // PGG returns 200 for 404 pages
    if (html.includes('page can') && html.includes('t be found')) return null;
    return html;
  } catch {
    return null;
  }
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—').replace(/&#8230;/g, '…');
}

// ---------------------------------------------------------------------------
// Reward translation (EN → ES)
// ---------------------------------------------------------------------------

const PHRASE_MAP = {
  'free rewards': 'recompensas gratis',
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
  'legendary': 'legendario',
};

function translateReward(text) {
  if (!text) return text;
  let result = unescapeHtml(text);

  // Remove (NEW) / (New) markers
  result = result.replace(/\s*\(NEW\)\s*/gi, '').trim();

  // Phrase replacements first
  for (const [en, es] of Object.entries(PHRASE_MAP)) {
    const regex = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, es);
  }

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

  return result;
}

// ---------------------------------------------------------------------------
// Pro Game Guides extraction
// ---------------------------------------------------------------------------

function extractPGG(html) {
  const hasTable = html.includes('code-text');

  if (hasTable) {
    return extractPGGTable(html);
  } else {
    return extractPGGList(html);
  }
}

/** New table format: <span class="code-text"> + <span class="description-text"> */
function extractPGGTable(html) {
  // Find active tab content
  const activeStart = html.indexOf('data-tab-content="active"');
  if (activeStart < 0) return null;

  // Find where inactive tab starts (or end of codes section)
  const inactiveStart = html.indexOf('data-tab-content="inactive"', activeStart);
  const howToRedeem = html.indexOf('how-to-redeem', activeStart);
  const activeEnd = Math.min(
    inactiveStart > 0 ? inactiveStart : Infinity,
    howToRedeem > 0 ? howToRedeem : Infinity,
    html.length
  );

  const activeSection = html.substring(activeStart, activeEnd);
  const activeCodes = extractTableCodes(activeSection);

  // Inactive/expired codes
  let expiredCodes = [];
  if (inactiveStart > 0) {
    const expiredEnd = howToRedeem > inactiveStart ? howToRedeem : html.length;
    const inactiveSection = html.substring(inactiveStart, expiredEnd);
    expiredCodes = extractTableCodes(inactiveSection);
  }

  // Also check for old-format expired section below
  const oldExpiredIdx = html.search(/<h[23][^>]*id="[^"]*expired[^"]*"/i);
  if (oldExpiredIdx > 0) {
    const oldExpSection = html.substring(oldExpiredIdx);
    const oldExp = extractListCodes(oldExpSection, true);
    expiredCodes = [...expiredCodes, ...oldExp];
  }

  return activeCodes.length > 0 || expiredCodes.length > 0
    ? { activeCodes, expiredCodes }
    : null;
}

function extractTableCodes(section) {
  const p = /<span class="code-text">([^<]+)<\/span>[\s\S]*?<span class="description-text">([^<]+)<\/span>/g;
  let m;
  const codes = [];
  const seen = new Set();
  while ((m = p.exec(section)) !== null) {
    const code = m[1].trim();
    const reward = m[2].trim();
    const key = code.toLowerCase();
    if (code.length >= 1 && code.length <= 60 && !seen.has(key)) {
      seen.add(key);
      codes.push({ code, reward });
    }
  }
  return codes;
}

/** Old list format: <li><strong>CODE</strong> – Reward</li> */
function extractPGGList(html) {
  // Find working/active section
  const workingIdx = html.search(/<h[23][^>]*id="[^"]*(?:working|active)[^"]*"/i);
  const expiredIdx = html.search(/<h[23][^>]*id="[^"]*expired[^"]*"/i);

  if (workingIdx < 0) return null;

  const activeSection = expiredIdx > workingIdx
    ? html.substring(workingIdx, expiredIdx)
    : html.substring(workingIdx);

  const activeCodes = extractListCodes(activeSection, false);

  let expiredCodes = [];
  if (expiredIdx > 0) {
    const howToIdx = html.indexOf('how-to-redeem', expiredIdx);
    const expSection = howToIdx > 0
      ? html.substring(expiredIdx, howToIdx)
      : html.substring(expiredIdx);
    expiredCodes = extractListCodes(expSection, true);
  }

  return activeCodes.length > 0 || expiredCodes.length > 0
    ? { activeCodes, expiredCodes }
    : null;
}

function extractListCodes(section, isExpiredSection) {
  const p = /<li[^>]*>\s*<strong>([^<]+)<\/strong>\s*(?:&ndash;|&nbsp;|–|-|—|\s)*(?:&ndash;|–|-|—)\s*(?:Redeem (?:code )?(?:for |to )?(?:a |an )?)?([^<(]+)/gi;
  let m;
  const codes = [];
  const seen = new Set();
  while ((m = p.exec(section)) !== null) {
    const code = m[1].trim().replace(/&nbsp;/g, '');
    const reward = m[2].trim().replace(/\s+/g, ' ');
    const key = code.toLowerCase();
    if (code.length >= 2 && code.length <= 50 && reward.length > 0 && !seen.has(key)) {
      seen.add(key);
      codes.push({ code, reward: unescapeHtml(reward) });
    }
  }

  // Also try plain format: <li><strong>CODE</strong></li>
  if (codes.length === 0) {
    const p2 = /<li[^>]*>\s*<strong>([A-Za-z0-9_!@#]+(?:\s[A-Za-z0-9_!@#]+)*)\s*<\/strong>\s*<\/li>/gi;
    while ((m = p2.exec(section)) !== null) {
      const code = m[1].trim();
      const key = code.toLowerCase();
      if (code.length >= 2 && !seen.has(key)) {
        seen.add(key);
        codes.push({ code, reward: 'Recompensas gratis' });
      }
    }
  }

  return codes;
}

// ---------------------------------------------------------------------------
// TryHardGuides extraction (backup)
// ---------------------------------------------------------------------------

function extractTHG(html) {
  const expIdx = html.search(/<h[23][^>]*>[^<]*Expired/i);
  const activeHtml = expIdx > 0 ? html.substring(0, expIdx) : html;
  const expiredHtml = expIdx > 0 ? html.substring(expIdx) : '';

  const pattern = /<li[^>]*>\s*<strong>([^<]+)<\/strong>\s*(?:&ndash;|&nbsp;|–|-|—|\s)*(?:&ndash;|–|-|—)\s*(?:Redeem (?:code )?(?:for |to )?(?:a |an )?)?([^<(]+)/gi;

  const activeCodes = [];
  const seen = new Set();
  let m;
  while ((m = pattern.exec(activeHtml)) !== null) {
    const code = m[1].trim().replace(/&nbsp;/g, '');
    const reward = m[2].trim().replace(/\s+/g, ' ');
    const key = code.toLowerCase();
    if (code.length >= 2 && code.length <= 50 && reward.length > 0 && !seen.has(key)) {
      seen.add(key);
      activeCodes.push({ code, reward: unescapeHtml(reward) });
    }
  }

  const expiredCodes = [];
  const seenExp = new Set();
  const expPattern = new RegExp(pattern.source, 'gi');
  while ((m = expPattern.exec(expiredHtml)) !== null) {
    const code = m[1].trim().replace(/&nbsp;/g, '');
    const reward = m[2].trim().replace(/\s+/g, ' ');
    const key = code.toLowerCase();
    if (code.length >= 2 && code.length <= 50 && reward.length > 0 && !seenExp.has(key)) {
      seenExp.add(key);
      expiredCodes.push({ code, reward: unescapeHtml(reward) });
    }
  }

  return activeCodes.length > 0 || expiredCodes.length > 0
    ? { activeCodes, expiredCodes }
    : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitFlag = args.indexOf('--limit');
  const limit = args.includes('--all') ? Infinity : (limitFlag >= 0 ? parseInt(args[limitFlag + 1]) : 30);

  // Load games with active codes, sorted by visits
  const files = fs.readdirSync(GAMES_DIR);
  const allGames = files
    .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')) }))
    .filter(g => g.activeCodes.length > 0 && !SKIP_SLUGS.has(g.slug))
    .sort((a, b) => (b.totalVisits || 0) - (a.totalVisits || 0))
    .slice(0, limit);

  console.log(`\nRe-scraping ${allGames.length} games (skipping Blox Fruits & Da Hood)\n`);

  let totalReplaced = 0;
  let gamesUpdated = 0;
  let gamesNotFound = 0;
  const report = [];

  for (let i = 0; i < allGames.length; i++) {
    const game = allGames[i];
    const slugs = slugVariations(game.name);
    const oldActive = game.activeCodes.length;

    process.stdout.write(`[${i + 1}/${allGames.length}] ${game.name} (${oldActive} active) `);

    // Try Pro Game Guides first
    let result = null;
    let source = '';

    for (const slug of slugs) {
      const url = `https://progameguides.com/roblox/roblox-${slug}-codes/`;
      const html = await fetchHtml(url);
      await sleep(DELAY_MS);
      if (html) {
        result = extractPGG(html);
        if (result) {
          source = 'PGG';
          break;
        }
      }
    }

    // Fallback: TryHardGuides
    if (!result) {
      for (const slug of slugs) {
        const url = `https://tryhardguides.com/${slug}-codes/`;
        const html = await fetchHtml(url);
        await sleep(DELAY_MS);
        if (html) {
          result = extractTHG(html);
          if (result) {
            source = 'THG';
            break;
          }
        }
      }
    }

    if (!result) {
      console.log('→ not found');
      gamesNotFound++;
      continue;
    }

    const newActive = result.activeCodes.length;
    const newExpired = result.expiredCodes.length;

    // REPLACE active codes entirely
    const existingExpiredKeys = new Set(game.expiredCodes.map(c => c.code.toLowerCase()));
    const newActiveKeys = new Set(result.activeCodes.map(c => c.code.toLowerCase()));

    // Translate rewards
    const translatedActive = result.activeCodes.map(c => ({
      code: c.code,
      reward: translateReward(c.reward),
    }));

    // Move our old active codes to expired if they're not in the new active list
    const oldToExpire = game.activeCodes.filter(c => !newActiveKeys.has(c.code.toLowerCase()));

    // Add old expired-from-active to expired list (avoid duplicates)
    for (const c of oldToExpire) {
      if (!existingExpiredKeys.has(c.code.toLowerCase())) {
        game.expiredCodes.push(c);
        existingExpiredKeys.add(c.code.toLowerCase());
      }
    }

    // Add source's expired codes too (avoid duplicates)
    for (const c of result.expiredCodes) {
      if (!existingExpiredKeys.has(c.code.toLowerCase()) && !newActiveKeys.has(c.code.toLowerCase())) {
        game.expiredCodes.push({
          code: c.code,
          reward: translateReward(c.reward),
        });
        existingExpiredKeys.add(c.code.toLowerCase());
      }
    }

    // Replace active codes
    game.activeCodes = translatedActive;
    game.lastUpdated = new Date().toISOString().slice(0, 10);

    const gameFile = path.join(GAMES_DIR, game.file);
    const { file, ...gameData } = game;
    if (!dryRun) {
      fs.writeFileSync(gameFile, JSON.stringify(gameData, null, 2) + '\n', 'utf8');
    }

    const moved = oldToExpire.length;
    const diff = newActive - oldActive;
    const arrow = diff > 0 ? `+${diff}` : `${diff}`;

    console.log(`→ ${source}: ${oldActive}→${newActive} active (${arrow}), moved ${moved} to expired${dryRun ? ' [DRY]' : ''}`);

    if (oldActive !== newActive || moved > 0) {
      gamesUpdated++;
      totalReplaced += moved;
      report.push({
        game: game.name,
        source,
        before: oldActive,
        after: newActive,
        moved,
      });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Re-scrape complete`);
  console.log(`  Games checked: ${allGames.length}`);
  console.log(`  Games updated: ${gamesUpdated}`);
  console.log(`  Games not found on any source: ${gamesNotFound}`);
  console.log(`  Total codes moved from active → expired: ${totalReplaced}`);

  if (report.length > 0) {
    console.log(`\n  Changes:`);
    for (const r of report) {
      const arrow = r.after - r.before;
      console.log(`    ${r.game}: ${r.before}→${r.after} active (${arrow >= 0 ? '+' : ''}${arrow}), −${r.moved} to expired [${r.source}]`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
