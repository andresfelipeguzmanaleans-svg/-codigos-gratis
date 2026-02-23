/**
 * verify-codes.mjs
 * Cross-references our active codes against GameRant and TryHardGuides
 * EXPIRED sections to find codes incorrectly listed as active.
 *
 * Strategy (conservative — only moves confirmed expired codes):
 *   1. Scrape GameRant expired section → confirmed expired
 *   2. Scrape TryHardGuides expired section → confirmed expired
 *   3. Heuristic: codes with year references older than current year
 *   4. Any of our "active" codes found in these lists → move to expired
 *
 * Usage: node scripts/verify-codes.mjs [--limit 30] [--all] [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const GAMES_DIR = 'data/games';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DELAY_MS = 1200;

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
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extract EXPIRED codes from sources (conservative approach)
// ---------------------------------------------------------------------------

/**
 * Extract codes from a source's EXPIRED section only.
 * Supports both formats:
 *   - <li><strong>CODE</strong> – reward</li>
 *   - <li><strong>CODE</strong></li> (no reward)
 */
function extractExpiredCodes(html) {
  const expMatch = html.match(/<h[23][^>]*>[^<]*(?:Expired|Inactive|Dead|No Longer)[^<]*/i);
  if (!expMatch) return new Set();

  const expIdx = html.indexOf(expMatch[0]);
  // Stop at FAQ or other non-code sections
  const faqIdx = html.indexOf('FAQ', expIdx + 100);
  const commentsIdx = html.indexOf('Comments', expIdx + 100);
  const endIdx = Math.min(
    faqIdx > 0 ? faqIdx : Infinity,
    commentsIdx > 0 ? commentsIdx : Infinity,
    html.length
  );
  const expiredHtml = html.substring(expIdx, endIdx);

  const codes = new Set();

  // Pattern 1: <li><strong>CODE</strong> – reward
  const p1 = /<li[^>]*>\s*(?:<[^>]*>\s*)*<strong>([^<]+)<\/strong>/gi;
  let m;
  while ((m = p1.exec(expiredHtml)) !== null) {
    const code = m[1].trim().replace(/&nbsp;/g, '').replace(/\s+$/, '');
    if (code.length >= 2 && code.length <= 50 &&
        !/^(Note|Update|New|This|How|Active|Related|Read|Network)/i.test(code)) {
      codes.add(code.toLowerCase());
    }
  }

  return codes;
}

// ---------------------------------------------------------------------------
// Heuristic: codes with old year/event references are likely expired
// ---------------------------------------------------------------------------

function isLikelyExpiredByName(code) {
  const lower = code.toLowerCase();
  const currentYear = new Date().getFullYear();

  // Codes containing a 4-digit year older than current
  const yearMatch4 = lower.match(/(20[12]\d)/);
  if (yearMatch4) {
    const year = parseInt(yearMatch4[1]);
    if (year < currentYear) return `contains year ${year}`;
  }

  // Codes ending in 2-digit year reference (e.g., XMAS23, HOODMAS24)
  // Match patterns like: word + 2 digits at end, or word + 2 digits
  const yearMatch2 = lower.match(/(?:christmas|xmas|halloween|easter|thanksgiving|valentine|newyear|lunar|hoodmas|snowman|reindeer|pumpkin|mummy|candycorn|summer|spring|winter|fall|autumn|holiday|nye|july4th|firework|laborday|school|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|sep|oct|nov|dec)s?(\d{2})(?:\D|$)/);
  if (yearMatch2) {
    const yr = parseInt(yearMatch2[1]);
    const fullYear = yr + 2000;
    if (fullYear < currentYear) return `event+year ${fullYear}`;
  }

  // Generic: code ends with 2-digit year like "24" "23" preceded by a letter
  // but only if it also has a seasonal/event word
  const seasonalWords = ['christmas', 'xmas', 'halloween', 'easter', 'thanksgiving',
    'valentine', 'newyear', 'lunar', 'hoodmas', 'snowman', 'reindeer',
    'spring', 'summer', 'winter', 'fall', 'holiday', 'nye', 'spooky'];

  for (const word of seasonalWords) {
    if (lower.includes(word)) {
      // Check for any year digits in the code
      const digits = lower.match(/\d{2,4}/);
      if (digits) {
        let yr = parseInt(digits[0]);
        if (yr < 100) yr += 2000;
        if (yr < currentYear) return `seasonal "${word}" + year ${yr}`;
      }
    }
  }

  return null;
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
  const games = files
    .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')) }))
    .filter(g => g.activeCodes.length > 0)
    .sort((a, b) => (b.totalVisits || 0) - (a.totalVisits || 0))
    .slice(0, limit);

  console.log(`\nVerifying ${games.length} games with active codes\n`);

  let totalMoved = 0;
  let gamesFixed = 0;
  const report = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const slugs = slugVariations(game.name);
    console.log(`[${i + 1}/${games.length}] ${game.name} (${game.activeCodes.length} active)`);

    // Collect confirmed expired codes from multiple sources
    const confirmedExpired = new Set();
    const sources = [];

    // Source 1: GameRant expired section
    for (const slug of slugs) {
      const url = `https://www.gamerant.com/roblox-${slug}-codes/`;
      const html = await fetchHtml(url);
      await sleep(DELAY_MS);
      if (html) {
        const expired = extractExpiredCodes(html);
        if (expired.size > 0) {
          expired.forEach(c => confirmedExpired.add(c));
          sources.push(`GameRant(${expired.size} expired)`);
        }
        break;
      }
    }

    // Source 2: TryHardGuides expired section
    for (const slug of slugs) {
      const url = `https://tryhardguides.com/${slug}-codes/`;
      const html = await fetchHtml(url);
      await sleep(DELAY_MS);
      if (html) {
        const expired = extractExpiredCodes(html);
        if (expired.size > 0) {
          expired.forEach(c => confirmedExpired.add(c));
          sources.push(`THG(${expired.size} expired)`);
        }
        break;
      }
    }

    if (sources.length > 0) {
      console.log(`  ✓ Sources: ${sources.join(', ')} → ${confirmedExpired.size} unique expired`);
    }

    // Check each of our active codes
    const toExpire = [];
    const existingExpired = new Set(game.expiredCodes.map(c => c.code.toLowerCase()));

    for (const c of game.activeCodes) {
      const key = c.code.toLowerCase().replace(/&nbsp;/g, '').trim();
      let reason = null;

      // Check 1: confirmed expired by sources
      if (confirmedExpired.has(key)) {
        reason = 'confirmed expired by source';
      }

      // Check 2: heuristic
      if (!reason) {
        reason = isLikelyExpiredByName(c.code);
      }

      if (reason) {
        toExpire.push({ ...c, reason });
      }
    }

    if (toExpire.length > 0) {
      const keptCount = game.activeCodes.length - toExpire.length;
      const expireKeys = new Set(toExpire.map(c => c.code.toLowerCase()));

      // Move codes
      game.activeCodes = game.activeCodes.filter(c => !expireKeys.has(c.code.toLowerCase()));
      for (const c of toExpire) {
        if (!existingExpired.has(c.code.toLowerCase())) {
          game.expiredCodes.push({ code: c.code, reward: c.reward });
        }
      }

      // Update file
      game.lastUpdated = new Date().toISOString().slice(0, 10);
      const gameFile = path.join(GAMES_DIR, game.file);
      const { file, ...gameData } = game;
      if (!dryRun) {
        fs.writeFileSync(gameFile, JSON.stringify(gameData, null, 2) + '\n', 'utf8');
      }

      console.log(`  → Moved ${toExpire.length} to expired (kept ${keptCount} active)${dryRun ? ' [DRY RUN]' : ''}`);
      toExpire.slice(0, 5).forEach(c => console.log(`    ✗ ${c.code} (${c.reason})`));
      if (toExpire.length > 5) console.log(`    ... and ${toExpire.length - 5} more`);

      totalMoved += toExpire.length;
      gamesFixed++;
      report.push({
        game: game.name,
        before: keptCount + toExpire.length,
        after: keptCount,
        moved: toExpire.length,
      });
    } else {
      console.log('  ✓ All codes verified');
    }
  }

  // Print report
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Verification complete`);
  console.log(`  Games checked: ${games.length}`);
  console.log(`  Games corrected: ${gamesFixed}`);
  console.log(`  Total codes moved to expired: ${totalMoved}`);

  if (report.length > 0) {
    console.log(`\n  Corrections:`);
    for (const r of report) {
      console.log(`    ${r.game}: ${r.before} → ${r.after} active (−${r.moved})`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
