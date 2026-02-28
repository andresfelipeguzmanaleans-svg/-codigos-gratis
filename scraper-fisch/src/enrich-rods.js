/**
 * Enrich rods.json with wiki descriptions, obtainment, and infobox stats.
 * Reads rods.json + wiki-rod-descriptions.json, merges, writes back.
 *
 * Run AFTER scrape-wiki-rods.js and BEFORE copy-to-astro.js.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'static');

function generateHowToGet(rod, wiki) {
  const parts = [];
  const stats = wiki.infoboxStats || {};
  const obtainedFrom = stats.obtainedFrom || wiki.obtainment || null;
  const price = stats.price || null;
  const stage = stats.stage || null;
  const location = stats.location || null;

  // Main obtainment line
  if (obtainedFrom && price) {
    parts.push(`Purchase from ${obtainedFrom} for ${price}.`);
  } else if (obtainedFrom) {
    parts.push(`Obtained from ${obtainedFrom}.`);
  }

  // Location context
  if (location && location !== obtainedFrom) {
    parts.push(`Location: ${location}.`);
  }

  // Stage requirement
  if (stage) {
    parts.push(`Requires Stage ${stage}.`);
  }

  // Passive ability
  if (stats.passive) {
    const passive = stats.passive.replace(/\n/g, ' ').trim();
    parts.push(`Passive: ${passive}.`);
  }

  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

function main() {
  const rodsFile = path.join(DATA_DIR, 'rods.json');
  const wikiFile = path.join(DATA_DIR, 'wiki-rod-descriptions.json');

  if (!fs.existsSync(rodsFile)) {
    console.error('rods.json not found');
    process.exit(1);
  }

  const rods = JSON.parse(fs.readFileSync(rodsFile, 'utf8'));
  let wikiData = {};
  if (fs.existsSync(wikiFile)) {
    wikiData = JSON.parse(fs.readFileSync(wikiFile, 'utf8'));
    console.log(`Wiki data: ${Object.keys(wikiData).length} entries`);
  } else {
    console.log('No wiki data found, skipping enrichment');
    return;
  }

  let enriched = 0;

  for (const rod of rods) {
    const wiki = wikiData[rod.id];
    if (!wiki) continue;

    if (wiki.description) {
      rod.description = wiki.description;
      enriched++;
    }

    const howToGet = generateHowToGet(rod, wiki);
    if (howToGet) {
      rod.howToGet = howToGet;
    }

    // Add extra stats from infobox
    if (wiki.infoboxStats) {
      const s = wiki.infoboxStats;
      if (s.obtainedFrom) rod.obtainedFrom = s.obtainedFrom;
      if (s.price) rod.price = s.price;
      if (s.stage) rod.stage = parseInt(s.stage) || null;
      if (s.location) rod.wikiLocation = s.location;
      if (s.passive) rod.passive = s.passive.replace(/\n/g, ' ').trim();
      if (s.maxWeight) rod.maxWeight = s.maxWeight;
    }
  }

  fs.writeFileSync(rodsFile, JSON.stringify(rods, null, 2));
  console.log(`\nEnriched ${enriched}/${rods.length} rods`);
  console.log(`Saved to ${rodsFile}`);
}

main();
