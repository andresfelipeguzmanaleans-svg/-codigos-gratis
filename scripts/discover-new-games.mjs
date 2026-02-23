/**
 * discover-new-games.mjs
 *
 * Re-downloads the game.guide sitemap, compares with data/gameguide-urls.json,
 * and adds new entries with scraped:false.
 *
 * Usage: node scripts/discover-new-games.mjs
 */

import fs from 'fs';
import https from 'https';

const URLS_FILE = 'data/gameguide-urls.json';
const SITEMAP_URL = 'https://www.game.guide/sitemap/1.xml';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const opts = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': UA },
      timeout: 30000,
    };
    const req = https.get(opts, res => {
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

function slugToName(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function main() {
  console.log('Descargando sitemap de game.guide...\n');

  const { status, body } = await httpGet(SITEMAP_URL);
  if (status !== 200) {
    console.error(`Error: sitemap devolvió status ${status}`);
    process.exit(1);
  }

  // Extract all /roblox-codes/SLUG URLs
  const urlPattern = /<loc>https?:\/\/www\.game\.guide\/roblox-codes\/([^<]+)<\/loc>/g;
  const sitemapSlugs = new Map();
  let match;
  while ((match = urlPattern.exec(body)) !== null) {
    const slug = match[1].replace(/\/$/, '');
    if (!slug.includes('/')) {
      sitemapSlugs.set(slug, `https://www.game.guide/roblox-codes/${slug}`);
    }
  }

  console.log(`Sitemap: ${sitemapSlugs.size} juegos Roblox encontrados\n`);

  // Load current catalog
  let catalog = [];
  if (fs.existsSync(URLS_FILE)) {
    catalog = JSON.parse(fs.readFileSync(URLS_FILE, 'utf-8'));
  }

  const existingSlugs = new Set(catalog.map(g => g.slug));

  // Find new games
  let added = 0;
  const newGames = [];
  for (const [slug, url] of sitemapSlugs) {
    if (!existingSlugs.has(slug)) {
      const entry = {
        slug,
        url,
        name: slugToName(slug),
        scraped: false,
      };
      catalog.push(entry);
      newGames.push(entry);
      added++;
    }
  }

  // Also check for games removed from sitemap
  const removedCount = catalog.filter(g => !sitemapSlugs.has(g.slug)).length;

  // Sort alphabetically
  catalog.sort((a, b) => a.slug.localeCompare(b.slug));

  // Save
  fs.writeFileSync(URLS_FILE, JSON.stringify(catalog, null, 2) + '\n');

  // Report
  const scraped = catalog.filter(g => g.scraped).length;
  const pending = catalog.filter(g => !g.scraped).length;

  console.log('='.repeat(60));
  console.log('RESULTADO');
  console.log('='.repeat(60));
  console.log(`Sitemap total:      ${sitemapSlugs.size}`);
  console.log(`Catálogo anterior:  ${existingSlugs.size}`);
  console.log(`Nuevos añadidos:    ${added}`);
  console.log(`Catálogo actual:    ${catalog.length}`);
  console.log(`  - Scraped:        ${scraped}`);
  console.log(`  - Pendientes:     ${pending}`);
  if (removedCount > 0) {
    console.log(`  - No en sitemap:  ${removedCount} (mantenidos en catálogo)`);
  }

  if (newGames.length > 0 && newGames.length <= 50) {
    console.log(`\nNuevos juegos:`);
    for (const g of newGames) {
      console.log(`  + ${g.slug} — ${g.name}`);
    }
  } else if (newGames.length > 50) {
    console.log(`\nPrimeros 50 nuevos juegos:`);
    for (const g of newGames.slice(0, 50)) {
      console.log(`  + ${g.slug} — ${g.name}`);
    }
    console.log(`  ... y ${newGames.length - 50} más`);
  }

  if (added === 0) {
    console.log('\nNo hay juegos nuevos. El catálogo está actualizado.');
  } else {
    console.log(`\nSiguiente paso: node scripts/scrape-all-new-games.mjs --limit N`);
  }
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
