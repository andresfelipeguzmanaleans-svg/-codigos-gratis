/**
 * scrape-codes-bulk.mjs
 * Scrapes active/expired Roblox codes from TryHardGuides and RockPaperShotgun
 * for games in our database that currently have 0 active codes.
 *
 * Usage: node scripts/scrape-codes-bulk.mjs [--limit 20] [--all]
 */

import fs from 'fs';
import path from 'path';

const GAMES_DIR = 'data/games';
const OUTPUT = 'data/scraped-codes.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ');
}

function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Generate slug variations to try (some sites abbreviate names) */
function slugVariations(name) {
  const base = nameToSlug(name);
  const variants = [base];

  // Remove "roblox-" prefix or "roblox " in name
  if (base.startsWith('roblox-')) variants.push(base.slice(7));

  // Common abbreviations
  const abbrevs = {
    'simulator': 'sim',
    'tycoon': 'tycoon',
  };
  for (const [long, short] of Object.entries(abbrevs)) {
    if (base.includes(long) && long !== short) {
      variants.push(base.replace(long, short));
    }
  }

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
// Code extraction
// ---------------------------------------------------------------------------

/**
 * TryHardGuides pattern:
 *   <li><strong>CODE</strong> &ndash; Redeem code for REWARD</li>
 *   <li><strong>CODE </strong>&ndash; Redeem code for a REWARD</li>
 */
function extractTryHardGuides(html) {
  const expiredIdx = html.search(/<h[23][^>]*>[^<]*Expired/i);
  const activeHtml = expiredIdx > 0 ? html.substring(0, expiredIdx) : html;
  const expiredHtml = expiredIdx > 0 ? html.substring(expiredIdx) : '';

  const pattern = /<li[^>]*>\s*<strong>([^<]+)<\/strong>\s*(?:&ndash;|&nbsp;|–|-|—|\s)*(?:&ndash;|&nbsp;|–|-|—)\s*(?:Redeem (?:code )?(?:for |to )?(?:a |an )?)?([^<(]+)/gi;

  const activeCodes = [];
  let m;
  while ((m = pattern.exec(activeHtml)) !== null) {
    const code = m[1].trim();
    const reward = m[2].trim().replace(/\s+/g, ' ');
    if (code.length >= 2 && code.length <= 50 && reward.length > 0) {
      activeCodes.push({ code, reward: unescapeHtml(reward) });
    }
  }

  const expiredCodes = [];
  const expPattern = /<li[^>]*>\s*<strong>([^<]+)<\/strong>\s*(?:&ndash;|&nbsp;|–|-|—|\s)*(?:&ndash;|&nbsp;|–|-|—)\s*(?:Redeem (?:code )?(?:for |to )?(?:a |an )?)?([^<(]+)/gi;
  while ((m = expPattern.exec(expiredHtml)) !== null) {
    const code = m[1].trim();
    const reward = m[2].trim().replace(/\s+/g, ' ');
    if (code.length >= 2 && code.length <= 50 && reward.length > 0) {
      expiredCodes.push({ code, reward: unescapeHtml(reward) });
    }
  }

  return { activeCodes, expiredCodes };
}

/**
 * RockPaperShotgun pattern:
 *   <strong>CODE</strong> – Reward description
 * They also use tables sometimes, and list items.
 */
function extractRockPaperShotgun(html) {
  const expiredIdx = html.search(/<h[23][^>]*>[^<]*(?:Expired|Outdated)/i);
  const activeHtml = expiredIdx > 0 ? html.substring(0, expiredIdx) : html;
  const expiredHtml = expiredIdx > 0 ? html.substring(expiredIdx) : '';

  function extract(section) {
    const codes = [];
    // Pattern 1: li > strong > code – reward
    const p1 = /<li[^>]*>(?:\s*<[^>]*>)*\s*<(?:strong|b)>([^<]+)<\/(?:strong|b)>\s*[-–—]\s*([^<]+)/gi;
    let m;
    while ((m = p1.exec(section)) !== null) {
      const code = m[1].trim();
      const reward = m[2].trim().replace(/\s+/g, ' ');
      if (code.length >= 2 && code.length <= 50 && reward.length > 0) {
        codes.push({ code, reward: unescapeHtml(reward) });
      }
    }
    // Pattern 2: strong>code</strong> – reward (not inside li)
    if (codes.length === 0) {
      const p2 = /<(?:strong|b)>([A-Za-z0-9_!@#]+(?:\s[A-Za-z0-9_!@#]+)?)<\/(?:strong|b)>\s*[-–—:]\s*([^<]+)/gi;
      while ((m = p2.exec(section)) !== null) {
        const code = m[1].trim();
        const reward = m[2].trim().replace(/\s+/g, ' ');
        if (code.length >= 2 && code.length <= 50 && reward.length > 0 && !/^(Note|Update|New|Active|Expired|How|Where|What|This|We |Our )/i.test(code)) {
          codes.push({ code, reward: unescapeHtml(reward) });
        }
      }
    }
    return codes;
  }

  return {
    activeCodes: extract(activeHtml),
    expiredCodes: extract(expiredHtml),
  };
}

// ---------------------------------------------------------------------------
// Source configs
// ---------------------------------------------------------------------------

const SOURCES = [
  {
    name: 'tryhardguides.com',
    makeUrl: (slug) => `https://tryhardguides.com/${slug}-codes/`,
    extract: extractTryHardGuides,
  },
  {
    name: 'rockpapershotgun.com',
    makeUrl: (slug) => `https://www.rockpapershotgun.com/roblox-${slug}-codes`,
    extract: extractRockPaperShotgun,
  },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limitFlag = args.indexOf('--limit');
  const limit = args.includes('--all') ? Infinity : (limitFlag >= 0 ? parseInt(args[limitFlag + 1]) : 20);

  // Load games with 0 active codes, sorted by visits
  const files = fs.readdirSync(GAMES_DIR);
  const games = files
    .map(f => JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')))
    .filter(g => g.activeCodes.length === 0)
    .sort((a, b) => (b.totalVisits || 0) - (a.totalVisits || 0))
    .slice(0, limit);

  console.log(`\nTarget: ${games.length} games with 0 active codes (top by visits)\n`);

  const results = [];
  let found = 0;
  let notFound = 0;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const slugs = slugVariations(game.name);
    console.log(`[${i + 1}/${games.length}] ${game.name} (slugs: ${slugs.join(', ')})`);

    let bestResult = null;

    for (const source of SOURCES) {
      if (bestResult && bestResult.activeCodes.length > 0) break;

      for (const slug of slugs) {
        const url = source.makeUrl(slug);
        const html = await fetchHtml(url);
        await sleep(DELAY_MS);

        if (!html) continue;

        const { activeCodes, expiredCodes } = source.extract(html);

        if (activeCodes.length > 0 || expiredCodes.length > 0) {
          const total = activeCodes.length + expiredCodes.length;
          if (!bestResult || total > (bestResult.activeCodes.length + bestResult.expiredCodes.length)) {
            bestResult = {
              gameName: game.name,
              slug: game.slug,
              source: source.name,
              sourceUrl: url,
              scrapedAt: new Date().toISOString().slice(0, 10),
              activeCodes,
              expiredCodes,
            };
          }
          console.log(`  ✓ ${source.name} → ${activeCodes.length} active, ${expiredCodes.length} expired`);
          if (activeCodes.length > 0) break; // Good enough, move on
        }
      }
    }

    if (bestResult) {
      results.push(bestResult);
      found++;
      if (bestResult.activeCodes.length > 0) {
        bestResult.activeCodes.slice(0, 3).forEach(c =>
          console.log(`    ${c.code} → ${c.reward}`)
        );
      }
    } else {
      notFound++;
      console.log('  ✗ No codes found on any source');
    }
  }

  // Save results
  fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2), 'utf8');

  const totalActive = results.reduce((s, r) => s + r.activeCodes.length, 0);
  const totalExpired = results.reduce((s, r) => s + r.expiredCodes.length, 0);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Done! Scraped ${games.length} games`);
  console.log(`  Games with codes found: ${found}`);
  console.log(`  Games with no codes: ${notFound}`);
  console.log(`  Total active codes: ${totalActive}`);
  console.log(`  Total expired codes: ${totalExpired}`);
  console.log(`  Saved to: ${OUTPUT}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
