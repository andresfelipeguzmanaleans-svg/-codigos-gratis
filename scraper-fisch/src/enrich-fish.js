/**
 * Enrich fish-merged.json with computed fields.
 * Reads fish-merged.json + rods.json + wiki-descriptions.json,
 * computes 7 fields, writes back.
 *
 * Run AFTER merge-data.js and BEFORE copy-to-astro.js.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'static');

// ---- Utilities ----

function formatCurrency(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T C$';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B C$';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M C$';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K C$';
  return n.toLocaleString('en-US') + ' C$';
}

// ---- Field 1: Recommended Rod ----

function computeRecommendedRod(fish, sortedRods) {
  if (fish.baseResil == null) return null;

  // Find lowest resilience rod that can handle this fish
  const match = sortedRods.find(r => r.resilience >= fish.baseResil);

  if (match) {
    return { name: match.name, rodId: match.id, resilience: match.resilience };
  }

  // No rod meets the requirement — return the highest available
  const best = sortedRods[sortedRods.length - 1];
  return best
    ? { name: best.name, rodId: best.id, resilience: best.resilience }
    : null;
}

// ---- Field 2: Difficulty ----

function computeDifficulty(fish) {
  // Factor 1: Catch Chance
  let chanceFactor;
  const chance = fish.baseChance;
  if (chance == null || chance === 0) chanceFactor = 2;
  else if (chance > 10) chanceFactor = 1;
  else if (chance >= 5) chanceFactor = 2;
  else if (chance >= 1) chanceFactor = 3;
  else chanceFactor = 4;

  // Factor 2: Resilience
  let resilFactor;
  const resil = fish.baseResil;
  if (resil == null) resilFactor = 2;
  else if (resil < 50) resilFactor = 1;
  else if (resil <= 200) resilFactor = 2;
  else if (resil <= 500) resilFactor = 3;
  else resilFactor = 4;

  // Factor 3: Conditions count
  let condCount = 0;
  if (fish.weather && fish.weather.length > 0) condCount++;
  if (fish.time) condCount++;
  if (fish.season && fish.season.length > 0) condCount++;
  if (fish.event) condCount++;
  if (fish.bait && fish.bait.length > 0) condCount++;

  let condFactor;
  if (condCount === 0) condFactor = 1;
  else if (condCount <= 2) condFactor = 2;
  else if (condCount === 3) condFactor = 3;
  else condFactor = 4;

  const avg = (chanceFactor + resilFactor + condFactor) / 3;

  if (avg <= 1.5) return 'Easy';
  if (avg <= 2.5) return 'Medium';
  if (avg <= 3.5) return 'Hard';
  return 'Extreme';
}

// ---- Field 3: Estimated C$/Hour ----

function computeEstimatedCsPerHour(fish) {
  if (fish.baseValue == null || fish.baseChance == null || !fish.weightRange) return null;
  if (fish.baseChance <= 0) return null;

  const avgWeight = (fish.weightRange.min + fish.weightRange.max) / 2;
  return Math.round((fish.baseValue * avgWeight) * (fish.baseChance / 100) * 60);
}

// ---- Field 4: Recommendation ----

function computeRecommendation(fish) {
  const rarity = (fish.rarity || '').toLowerCase();

  const keepRarities = [
    'limited', 'extinct', 'apex', 'special', 'relic',
    'fragment', 'gemstone', 'divine secret',
  ];
  if (keepRarities.includes(rarity)) return 'KEEP FOR TRADING';

  const conditionalKeep = ['exotic', 'mythical', 'secret'];
  if (conditionalKeep.includes(rarity) && fish.baseChance != null && fish.baseChance < 5) {
    return 'KEEP FOR TRADING';
  }

  return 'SELL TO NPC';
}

// ---- Field 5: Estimated NPC Value ----

function computeEstimatedNpcValue(fish) {
  if (fish.baseValue == null || !fish.weightRange) return null;
  const avgWeight = (fish.weightRange.min + fish.weightRange.max) / 2;
  return formatCurrency(Math.round(fish.baseValue * avgWeight));
}

// ---- Field 6: Auto Description ----

function computeDescription(fish, difficulty) {
  const parts = [];

  parts.push(fish.name + ' is a ' + (fish.rarity || 'unknown').toLowerCase() + ' fish');
  if (fish.location) {
    parts.push(' found in ' + fish.location);
    if (fish.sublocation) parts.push(' (' + fish.sublocation + ')');
  }
  parts.push('.');

  if (fish.baseValue && fish.weightRange) {
    const maxVal = fish.baseValue * fish.weightRange.max;
    parts.push(' It has a base value of ' + fish.baseValue.toLocaleString('en-US') + ' C$/kg');
    parts.push(' with a weight range of ' + fish.weightRange.min.toLocaleString('en-US'));
    parts.push('-' + fish.weightRange.max.toLocaleString('en-US') + ' kg.');
  }

  if (fish.bait && fish.bait.length > 0) {
    parts.push(' Best caught using ' + fish.bait.join(' or ') + '.');
  }

  if (fish.weather && fish.weather.length > 0) {
    parts.push(' Appears during ' + fish.weather.join(' or ').toLowerCase() + ' weather.');
  }

  if (fish.time) {
    parts.push(' Active at ' + fish.time.toLowerCase() + '.');
  }

  if (fish.event) {
    parts.push(' This is a limited fish from the ' + fish.event + ' event.');
  }

  if (difficulty) {
    const text = {
      Easy: 'This is an easy catch, great for beginners.',
      Medium: 'This is a moderate catch that requires some preparation.',
      Hard: 'This is a challenging catch that demands good gear and timing.',
      Extreme: 'This is an extremely difficult catch reserved for experienced anglers.',
    };
    parts.push(' ' + text[difficulty]);
  }

  return parts.join('');
}

// ---- Field 7: How to Catch ----

function computeHowToCatch(fish, wikiDesc) {
  const paragraphs = [];

  // a) Wiki lore (trimmed to 1-2 sentences)
  if (wikiDesc && wikiDesc.lore) {
    paragraphs.push(wikiDesc.lore);
  }

  // b) Location
  if (fish.location) {
    let loc = 'Head to ' + fish.location;
    if (fish.sublocation) loc += ' (' + fish.sublocation + ')';
    loc += '.';
    if (fish.sea) loc += ' You will need a boat to reach this sea location.';
    paragraphs.push(loc);
  }

  // c) Rod + bait
  if (fish.recommendedRod) {
    let gear = 'Equip the ' + fish.recommendedRod.name + ' (or higher)';
    if (fish.bait && fish.bait.length > 0) {
      gear += ' and use ' + fish.bait.join(' or ') + ' as bait';
    }
    gear += '.';
    paragraphs.push(gear);
  } else if (fish.bait && fish.bait.length > 0) {
    paragraphs.push('Use ' + fish.bait.join(' or ') + ' as bait.');
  }

  // d) Weather, time, season conditions
  const conditions = [];
  if (fish.weather && fish.weather.length > 0) {
    conditions.push('Wait for ' + fish.weather.join(' or ') + ' weather.');
  }
  if (fish.time) {
    conditions.push('Fish at ' + fish.time + '.');
  }
  if (fish.season && fish.season.length > 0) {
    conditions.push('Available during ' + fish.season.join(' or ') + '.');
  }
  if (conditions.length > 0) {
    paragraphs.push(conditions.join(' '));
  }

  // e) Non-rod source
  const wikiSource = wikiDesc && wikiDesc.wikiSource;
  const sources = fish.sources || [];
  const hasRod = (wikiSource && wikiSource.includes('Fishing Rod'))
    || sources.includes('Fishing Rod');
  const isNonRod = !hasRod && (
    (wikiSource != null)
    || (sources.length > 0)
  );
  if (isNonRod) {
    const src = wikiSource || sources.join(', ');
    paragraphs.push('This fish is caught using ' + src + ', not a regular fishing rod.');
  }

  // f) Event-limited
  if (fish.event) {
    paragraphs.push('This is a limited fish from the ' + fish.event + ' event. It may not be currently obtainable.');
  }

  // g) Difficulty tip + recommendation + C$/hr
  const tips = [];
  if (fish.difficulty) {
    const diffTips = {
      Easy: 'This is an easy catch, great for beginners.',
      Medium: 'A moderate catch that requires some preparation.',
      Hard: 'A challenging catch — bring your best gear and time it right.',
      Extreme: 'An extremely difficult catch reserved for experienced anglers with top-tier equipment.',
    };
    tips.push(diffTips[fish.difficulty] || '');
  }
  if (fish.recommendation) {
    if (fish.recommendation === 'KEEP FOR TRADING') {
      tips.push('Recommended to keep for trading rather than selling to NPC.');
    } else {
      tips.push('Best sold to NPC for quick profit.');
    }
  }
  if (fish.estimatedCsPerHour != null && fish.estimatedCsPerHour > 0) {
    tips.push('Estimated earnings: ~' + formatCurrency(fish.estimatedCsPerHour) + '/hr.');
  }
  if (tips.length > 0) {
    paragraphs.push(tips.join(' '));
  }

  if (paragraphs.length === 0) return null;

  return paragraphs.join('\n\n');
}

// ---- Main ----

function main() {
  console.log('Enriching fish data with computed fields...\n');

  const fish = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fish-merged.json'), 'utf8'));
  const rods = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'rods.json'), 'utf8'));

  // Load wiki descriptions (graceful fallback)
  let wikiDescs = {};
  const wikiDescFile = path.join(DATA_DIR, 'wiki-descriptions.json');
  if (fs.existsSync(wikiDescFile)) {
    try {
      wikiDescs = JSON.parse(fs.readFileSync(wikiDescFile, 'utf8'));
      console.log('Wiki descriptions loaded: ' + Object.keys(wikiDescs).length + ' entries');
    } catch {
      console.log('Warning: could not parse wiki-descriptions.json, skipping');
    }
  } else {
    console.log('No wiki-descriptions.json found, howToCatch will use structured data only');
  }

  // Pre-sort rods: positive resilience only, ascending
  const candidateRods = rods
    .filter(r => r.resilience > 0)
    .sort((a, b) => a.resilience - b.resilience);

  console.log('Fish: ' + fish.length + ', Candidate rods: ' + candidateRods.length);

  const stats = { rod: 0, difficulty: {}, csPerHour: 0, keep: 0, sell: 0, npcVal: 0, descGen: 0, howToCatch: 0 };

  for (const f of fish) {
    // 1. Recommended Rod
    f.recommendedRod = computeRecommendedRod(f, candidateRods);
    if (f.recommendedRod) stats.rod++;

    // 2. Difficulty
    f.difficulty = computeDifficulty(f);
    stats.difficulty[f.difficulty] = (stats.difficulty[f.difficulty] || 0) + 1;

    // 3. Estimated C$/Hour
    f.estimatedCsPerHour = computeEstimatedCsPerHour(f);
    if (f.estimatedCsPerHour != null) stats.csPerHour++;

    // 4. Recommendation
    f.recommendation = computeRecommendation(f);
    if (f.recommendation === 'KEEP FOR TRADING') stats.keep++;
    else stats.sell++;

    // 5. Estimated NPC Value
    f.estimatedNpcValue = computeEstimatedNpcValue(f);
    if (f.estimatedNpcValue) stats.npcVal++;

    // 6. Description (auto-generate only if missing)
    const hadManualDesc = !!f.description && !f.descriptionIsGenerated;
    if (hadManualDesc) {
      f.descriptionIsGenerated = false;
    } else {
      f.description = computeDescription(f, f.difficulty);
      f.descriptionIsGenerated = true;
      stats.descGen++;
    }

    // 7. How to Catch
    const wikiDesc = wikiDescs[f.id] || null;
    f.howToCatch = computeHowToCatch(f, wikiDesc);
    if (f.howToCatch) stats.howToCatch++;
  }

  // Write back
  fs.writeFileSync(
    path.join(DATA_DIR, 'fish-merged.json'),
    JSON.stringify(fish, null, 2),
  );

  console.log('\n========================================');
  console.log('Enrichment complete:');
  console.log('  Recommended rod:  ' + stats.rod + '/' + fish.length);
  console.log('  Difficulty:       ' + JSON.stringify(stats.difficulty));
  console.log('  C$/Hour computed: ' + stats.csPerHour + '/' + fish.length);
  console.log('  KEEP FOR TRADING: ' + stats.keep);
  console.log('  SELL TO NPC:      ' + stats.sell);
  console.log('  NPC Value:        ' + stats.npcVal + '/' + fish.length);
  console.log('  Descriptions gen: ' + stats.descGen);
  console.log('  How to Catch:     ' + stats.howToCatch + '/' + fish.length);
  console.log('========================================\n');
}

main();
