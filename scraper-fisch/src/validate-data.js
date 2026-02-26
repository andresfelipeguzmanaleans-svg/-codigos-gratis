const fs = require('fs');
const path = require('path');

const STATIC = path.join(__dirname, '..', 'data', 'static');
const DYNAMIC = path.join(__dirname, '..', 'data', 'dynamic');

// ---- Utils ----

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function pct(n, total) {
  if (total === 0) return '0.0';
  return ((n / total) * 100).toFixed(1);
}

function isNum(v) {
  return typeof v === 'number' && !isNaN(v);
}

function isFilled(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// ---- Validators ----

function validateFishMerged(data) {
  const issues = { errors: [], warnings: [], fieldCoverage: {} };
  if (!Array.isArray(data)) { issues.errors.push('Not an array'); return issues; }

  const fields = [
    'id', 'name', 'rarity', 'location', 'xp', 'baseValue', 'baseWeight',
    'weightRange', 'bait', 'weather', 'time', 'season', 'baseChance',
    'baseResil', 'description', 'image', 'event', 'sea', 'sources', 'sublocation',
  ];

  const nullCounts = {};
  fields.forEach(f => { nullCounts[f] = 0; });

  for (const fish of data) {
    // Required fields
    if (!fish.id) issues.errors.push(`Pez sin id: "${fish.name}"`);
    if (!fish.name) issues.errors.push(`Pez sin name (id=${fish.id})`);
    if (!fish.rarity) issues.errors.push(`Pez sin rarity: "${fish.name}"`);

    // Type checks
    if (fish.baseValue !== null && !isNum(fish.baseValue))
      issues.errors.push(`baseValue no es número: "${fish.name}" = ${JSON.stringify(fish.baseValue)}`);
    if (fish.baseWeight !== null && !isNum(fish.baseWeight))
      issues.errors.push(`baseWeight no es número: "${fish.name}" = ${JSON.stringify(fish.baseWeight)}`);
    if (fish.xp !== null && !isNum(fish.xp))
      issues.errors.push(`xp no es número: "${fish.name}" = ${JSON.stringify(fish.xp)}`);

    // Suspicious values
    if (fish.baseValue === 0) issues.warnings.push(`baseValue=0: "${fish.name}"`);
    if (fish.xp !== null && fish.xp < 0) issues.warnings.push(`xp negativo: "${fish.name}" = ${fish.xp}`);
    if (fish.baseWeight !== null && fish.baseWeight < 0) issues.warnings.push(`baseWeight negativo: "${fish.name}" = ${fish.baseWeight}`);

    // Null counts
    for (const f of fields) {
      if (!isFilled(fish[f])) nullCounts[f]++;
    }
  }

  issues.fieldCoverage = {};
  for (const f of fields) {
    const filled = data.length - nullCounts[f];
    issues.fieldCoverage[f] = { filled, total: data.length, pct: pct(filled, data.length) };
  }

  return issues;
}

function validateMutationsMerged(data) {
  const issues = { errors: [], warnings: [], fieldCoverage: {} };
  if (!Array.isArray(data)) { issues.errors.push('Not an array'); return issues; }

  const fields = ['id', 'name', 'multiplier', 'category', 'appraisable', 'obtainMethod', 'wikiNotes'];
  const nullCounts = {};
  fields.forEach(f => { nullCounts[f] = 0; });

  for (const m of data) {
    if (!m.name) issues.errors.push(`Mutación sin name (id=${m.id})`);

    // Multiplier checks
    const mult = typeof m.multiplier === 'number' ? m.multiplier : m.multiplier?.max;
    if (mult === null || mult === undefined) {
      issues.warnings.push(`Sin multiplicador: "${m.name}"`);
    } else {
      if (mult > 20) issues.warnings.push(`Multiplicador muy alto: "${m.name}" = ${mult}x`);
      if (mult < -1) issues.warnings.push(`Multiplicador muy negativo: "${m.name}" = ${mult}x`);
    }

    for (const f of fields) {
      if (!isFilled(m[f])) nullCounts[f]++;
    }
  }

  issues.fieldCoverage = {};
  for (const f of fields) {
    const filled = data.length - nullCounts[f];
    issues.fieldCoverage[f] = { filled, total: data.length, pct: pct(filled, data.length) };
  }

  return issues;
}

function validateRods(data) {
  const issues = { errors: [], warnings: [], fieldCoverage: {} };
  if (!Array.isArray(data)) { issues.errors.push('Not an array'); return issues; }

  const fields = ['id', 'name', 'luckBonus', 'control', 'resilience', 'lureSpeed', 'obtainMethod'];
  const nullCounts = {};
  fields.forEach(f => { nullCounts[f] = 0; });

  for (const r of data) {
    if (!r.name) issues.errors.push(`Caña sin name (id=${r.id})`);

    const hasAnyStat = (r.luckBonus !== 0 && r.luckBonus != null) ||
                       (r.control !== 0 && r.control != null) ||
                       (r.resilience !== 0 && r.resilience != null) ||
                       (r.lureSpeed !== 0 && r.lureSpeed != null);
    if (!hasAnyStat) issues.warnings.push(`Todos los stats en 0: "${r.name}"`);

    if (r.luckBonus !== null && !isNum(r.luckBonus))
      issues.errors.push(`luckBonus no es número: "${r.name}"`);

    // Suspicious
    if (r.resilience !== null && r.resilience < -1000000)
      issues.warnings.push(`resilience extremo: "${r.name}" = ${r.resilience}`);

    for (const f of fields) {
      if (!isFilled(r[f])) nullCounts[f]++;
    }
  }

  issues.fieldCoverage = {};
  for (const f of fields) {
    const filled = data.length - nullCounts[f];
    issues.fieldCoverage[f] = { filled, total: data.length, pct: pct(filled, data.length) };
  }

  return issues;
}

function validateLocations(data) {
  const issues = { errors: [], warnings: [], fieldCoverage: {} };
  if (!Array.isArray(data)) { issues.errors.push('Not an array'); return issues; }

  const fields = ['id', 'name', 'description', 'availableWeathers', 'fishCount', 'fish'];
  const nullCounts = {};
  fields.forEach(f => { nullCounts[f] = 0; });

  for (const l of data) {
    if (!l.name) issues.errors.push(`Ubicación sin name (id=${l.id})`);
    if (l.fishCount === 0 && !l.isEvent) issues.warnings.push(`Sin peces: "${l.name}"`);

    for (const f of fields) {
      if (!isFilled(l[f])) nullCounts[f]++;
    }
  }

  issues.fieldCoverage = {};
  for (const f of fields) {
    const filled = data.length - nullCounts[f];
    issues.fieldCoverage[f] = { filled, total: data.length, pct: pct(filled, data.length) };
  }

  return issues;
}

function validateTradingValues(data) {
  const issues = { errors: [], warnings: [], fieldCoverage: {} };
  const items = data?.items;
  if (!Array.isArray(items)) { issues.errors.push('items is not an array'); return issues; }

  const fields = ['itemId', 'name', 'rarity', 'basePrice', 'weightRange', 'estimatedValue', 'baseCatchRate'];
  const nullCounts = {};
  fields.forEach(f => { nullCounts[f] = 0; });

  for (const item of items) {
    if (!item.name) issues.errors.push(`Item sin name (id=${item.itemId})`);

    if (item.basePrice !== null && !isNum(item.basePrice))
      issues.errors.push(`basePrice no es número: "${item.name}"`);
    if (item.basePrice === 0) issues.warnings.push(`basePrice=0: "${item.name}"`);
    if (item.basePrice !== null && item.basePrice < 0)
      issues.warnings.push(`basePrice negativo: "${item.name}" = ${item.basePrice}`);

    for (const f of fields) {
      if (!isFilled(item[f])) nullCounts[f]++;
    }
  }

  issues.fieldCoverage = {};
  for (const f of fields) {
    const filled = items.length - nullCounts[f];
    issues.fieldCoverage[f] = { filled, total: items.length, pct: pct(filled, items.length) };
  }

  return issues;
}

// ---- Report ----

function printReport(label, data, issues) {
  const count = Array.isArray(data) ? data.length : (data?.items?.length || 0);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label} (${count} registros)`);
  console.log(`${'─'.repeat(60)}`);

  if (issues.errors.length > 0) {
    console.log(`\n  ERRORES (${issues.errors.length}):`);
    issues.errors.slice(0, 10).forEach(e => console.log(`    [!] ${e}`));
    if (issues.errors.length > 10) console.log(`    ... y ${issues.errors.length - 10} más`);
  }

  if (issues.warnings.length > 0) {
    console.log(`\n  ADVERTENCIAS (${issues.warnings.length}):`);
    issues.warnings.slice(0, 10).forEach(w => console.log(`    [?] ${w}`));
    if (issues.warnings.length > 10) console.log(`    ... y ${issues.warnings.length - 10} más`);
  }

  if (Object.keys(issues.fieldCoverage).length > 0) {
    console.log(`\n  COBERTURA DE CAMPOS:`);
    const maxLabel = Math.max(...Object.keys(issues.fieldCoverage).map(k => k.length));
    for (const [field, cov] of Object.entries(issues.fieldCoverage)) {
      const bar = buildBar(parseFloat(cov.pct));
      const missing = cov.total - cov.filled;
      const missingStr = missing > 0 ? ` (${missing} vacios)` : '';
      console.log(`    ${field.padEnd(maxLabel)} ${bar} ${cov.pct.padStart(5)}%  ${cov.filled}/${cov.total}${missingStr}`);
    }
  }

  return issues;
}

function buildBar(pct) {
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ---- Health Score ----

function computeHealthScore(allIssues) {
  let totalFields = 0;
  let totalFilled = 0;
  let totalErrors = 0;

  for (const issues of allIssues) {
    totalErrors += issues.errors.length;
    for (const cov of Object.values(issues.fieldCoverage)) {
      totalFields += cov.total;
      totalFilled += cov.filled;
    }
  }

  const coveragePct = totalFields > 0 ? (totalFilled / totalFields) * 100 : 0;
  // Penalty: -1% per error, capped at -20%
  const errorPenalty = Math.min(totalErrors * 1, 20);
  const score = Math.max(0, Math.min(100, coveragePct - errorPenalty));

  return { score, coveragePct, totalErrors, totalFields, totalFilled };
}

// ---- Main ----

function main() {
  console.log('');
  console.log('  ════════════════════════════════════════════════════════');
  console.log('  FISCH DATA VALIDATOR');
  console.log('  ════════════════════════════════════════════════════════');

  const allIssues = [];

  // 1. fish-merged.json
  const fishMerged = readJson(path.join(STATIC, 'fish-merged.json'));
  if (fishMerged) {
    allIssues.push(printReport('fish-merged.json', fishMerged, validateFishMerged(fishMerged)));
  } else {
    console.log('\n  [SKIP] fish-merged.json no encontrado');
  }

  // 2. mutations-merged.json
  const mutMerged = readJson(path.join(STATIC, 'mutations-merged.json'));
  if (mutMerged) {
    allIssues.push(printReport('mutations-merged.json', mutMerged, validateMutationsMerged(mutMerged)));
  } else {
    console.log('\n  [SKIP] mutations-merged.json no encontrado');
  }

  // 3. rods.json
  const rods = readJson(path.join(STATIC, 'rods.json'));
  if (rods) {
    allIssues.push(printReport('rods.json', rods, validateRods(rods)));
  } else {
    console.log('\n  [SKIP] rods.json no encontrado');
  }

  // 4. locations.json
  const locations = readJson(path.join(STATIC, 'locations.json'));
  if (locations) {
    allIssues.push(printReport('locations.json', locations, validateLocations(locations)));
  } else {
    console.log('\n  [SKIP] locations.json no encontrado');
  }

  // 5. trading-values.json
  const values = readJson(path.join(DYNAMIC, 'trading-values.json'));
  if (values) {
    allIssues.push(printReport('trading-values.json', values, validateTradingValues(values)));
  } else {
    console.log('\n  [SKIP] trading-values.json no encontrado');
  }

  // ---- Health Score ----
  const health = computeHealthScore(allIssues);

  let grade, gradeLabel;
  if (health.score >= 90) { grade = 'A'; gradeLabel = 'Excelente'; }
  else if (health.score >= 80) { grade = 'B'; gradeLabel = 'Bueno'; }
  else if (health.score >= 70) { grade = 'C'; gradeLabel = 'Aceptable'; }
  else if (health.score >= 50) { grade = 'D'; gradeLabel = 'Mejorable'; }
  else { grade = 'F'; gradeLabel = 'Pobre'; }

  const totalErrors = allIssues.reduce((s, i) => s + i.errors.length, 0);
  const totalWarnings = allIssues.reduce((s, i) => s + i.warnings.length, 0);

  console.log('');
  console.log('  ════════════════════════════════════════════════════════');
  console.log('  HEALTH SCORE');
  console.log('  ════════════════════════════════════════════════════════');
  console.log(`  Score:      ${health.score.toFixed(1)}% (${grade} - ${gradeLabel})`);
  console.log(`  Cobertura:  ${health.coveragePct.toFixed(1)}% (${health.totalFilled.toLocaleString()} / ${health.totalFields.toLocaleString()} campos)`);
  console.log(`  Errores:    ${totalErrors}`);
  console.log(`  Warnings:   ${totalWarnings}`);
  console.log('  ════════════════════════════════════════════════════════');
  console.log('');

  if (totalErrors > 0) process.exit(1);
}

main();
