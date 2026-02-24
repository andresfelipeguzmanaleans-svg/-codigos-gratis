/**
 * scrape-manual.mjs
 * Search alternative sources for games the main scraper missed.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ');
}

async function fetchHtml(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (res.status !== 200) return null;
    return await res.text();
  } catch { return null; }
}

function extractCodes(html) {
  const expiredIdx = html.search(/<h[23][^>]*>[^<]*(?:Expired|Outdated|Invalid|Old)/i);
  const activeHtml = expiredIdx > 0 ? html.substring(0, expiredIdx) : html;
  const expiredHtml = expiredIdx > 0 ? html.substring(expiredIdx) : '';

  function parse(section) {
    const codes = [];
    // Pattern: <li><strong>CODE</strong> – reward
    const p1 = /<li[^>]*>(?:\s*<[^>]*>)*\s*<(?:strong|b)>([^<]+)<\/(?:strong|b)>\s*(?:&ndash;|&nbsp;|–|-|—|\s)*(?:&ndash;|–|-|—)\s*(?:Redeem (?:code )?(?:for |to )?(?:a |an )?)?([^<(]+)/gi;
    let m;
    while ((m = p1.exec(section)) !== null) {
      const code = m[1].trim();
      const reward = unescapeHtml(m[2].trim().replace(/\s+/g, ' '));
      if (code.length >= 2 && code.length <= 50 && reward.length > 0) codes.push({ code, reward });
    }
    // Pattern: <strong>CODE</strong> – reward (not in li)
    if (codes.length === 0) {
      const p2 = /<(?:strong|b)>([A-Za-z0-9_!@#]+)<\/(?:strong|b)>\s*[-–—:]\s*([^<]+)/gi;
      while ((m = p2.exec(section)) !== null) {
        const code = m[1].trim();
        const reward = unescapeHtml(m[2].trim().replace(/\s+/g, ' '));
        if (code.length >= 2 && code.length <= 50 && reward.length > 0 && !/^(Note|Update|New|Active|Expired|How|Where|What|This|We |Our )/i.test(code)) {
          codes.push({ code, reward });
        }
      }
    }
    // Pattern: table rows
    if (codes.length === 0) {
      const p3 = /<tr[^>]*>\s*<td[^>]*>(?:\s*<[^>]*>)*([A-Za-z0-9_!]+)(?:<[^>]*>)*\s*<\/td>\s*<td[^>]*>([^<]+)/gi;
      while ((m = p3.exec(section)) !== null) {
        const code = m[1].trim();
        const reward = unescapeHtml(m[2].trim());
        if (code.length >= 2 && !code.toLowerCase().includes('code')) codes.push({ code, reward });
      }
    }
    return codes;
  }

  return { activeCodes: parse(activeHtml), expiredCodes: parse(expiredHtml) };
}

const games = [
  { name: 'Murder Mystery 2', slugs: ['murder-mystery-2', 'mm2'] },
  { name: 'Mad City', slugs: ['mad-city'] },
  { name: 'Pet Simulator 99', slugs: ['pet-simulator-99', 'pet-sim-99'] },
  { name: 'Dungeon Quest', slugs: ['dungeon-quest'] },
];

const sources = [
  { name: 'beebom.com', make: s => `https://beebom.com/roblox-${s}-codes/` },
  { name: 'beebom.com', make: s => `https://beebom.com/${s}-codes-roblox/` },
  { name: 'gamerant.com', make: s => `https://gamerant.com/roblox-${s}-codes/` },
  { name: 'gamerant.com', make: s => `https://gamerant.com/roblox-${s}-all-codes/` },
  { name: 'dexerto.com', make: s => `https://www.dexerto.com/roblox/${s}-codes/` },
  { name: 'dexerto.com', make: s => `https://www.dexerto.com/roblox/${s}-codes-active-list/` },
  // Also try some other known sources
  { name: 'attackofthefanboy.com', make: s => `https://attackofthefanboy.com/roblox/${s}-codes/` },
  { name: 'gamesradar.com', make: s => `https://www.gamesradar.com/roblox-${s}-codes/` },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

for (const game of games) {
  console.log(`\n=== ${game.name} ===`);
  let best = null;

  for (const slug of game.slugs) {
    for (const source of sources) {
      const url = source.make(slug);
      const html = await fetchHtml(url);
      await sleep(1000);
      if (!html) { continue; }

      const { activeCodes, expiredCodes } = extractCodes(html);
      const total = activeCodes.length + expiredCodes.length;
      if (total > 0) {
        console.log(`  ✓ ${source.name} (${url})`);
        console.log(`    Active: ${activeCodes.length}, Expired: ${expiredCodes.length}`);
        activeCodes.slice(0, 3).forEach(c => console.log(`      ${c.code} → ${c.reward}`));
        if (!best || total > (best.activeCodes.length + best.expiredCodes.length)) {
          best = { source: source.name, url, activeCodes, expiredCodes };
        }
        if (activeCodes.length > 0) break;
      }
    }
    if (best && best.activeCodes.length > 0) break;
  }

  if (!best) {
    console.log('  ✗ No codes found on any alternative source');
  } else {
    console.log(`  BEST: ${best.source} — ${best.activeCodes.length} active, ${best.expiredCodes.length} expired`);
  }
}
