const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const STATIC = path.join(DATA_DIR, 'static');
const DYNAMIC = path.join(DATA_DIR, 'dynamic');
const NODE = process.execPath;

// ---- Pipeline definition ----

const STEPS = [
  {
    id: 'fish-list',
    label: 'Scrapeando lista de peces (fischcalculator)',
    script: 'src/sources/scrape-fish.js',
    outputFile: () => path.join(STATIC, 'fish-list.json'),
    summarize: data => `${data.length} peces`,
  },
  {
    id: 'fish-details',
    label: 'Scrapeando detalles de peces (fischcalculator)',
    script: 'src/sources/scrape-fish-details.js',
    outputFile: () => path.join(STATIC, 'fish-complete.json'),
    summarize: data => {
      const withData = data.filter(f => f.baseValue !== null);
      return `${data.length} peces (${withData.length} con datos)`;
    },
  },
  {
    id: 'mutations',
    label: 'Scrapeando mutaciones (fischcalculator)',
    script: 'src/sources/scrape-mutations.js',
    outputFile: () => path.join(STATIC, 'mutations.json'),
    summarize: data => `${data.length} mutaciones`,
  },
  {
    id: 'rods',
    label: 'Scrapeando cañas (fischcalculator)',
    script: 'src/sources/scrape-rods.js',
    outputFile: () => path.join(STATIC, 'rods.json'),
    summarize: data => {
      const withStats = data.filter(r => r.luckBonus !== 0 || r.control !== 0);
      return `${data.length} cañas (${withStats.length} con stats)`;
    },
  },
  {
    id: 'locations',
    label: 'Scrapeando ubicaciones (fischcalculator)',
    script: 'src/sources/scrape-locations.js',
    outputFile: () => path.join(STATIC, 'locations.json'),
    summarize: data => {
      const withFish = data.filter(l => l.fishCount > 0);
      return `${data.length} ubicaciones (${withFish.length} con peces)`;
    },
  },
  {
    id: 'wiki-fish',
    label: 'Scrapeando peces de la wiki (fischipedia.org)',
    script: 'src/sources/scrape-wiki.js',
    preCheck: async () => {
      // Quick check if the wiki API is reachable
      try {
        const fetch = require('node-fetch');
        const res = await fetch('https://fischipedia.org/w/api.php?action=query&meta=siteinfo&format=json', {
          headers: {
            'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
            'Accept': 'application/json',
          },
          timeout: 10000,
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    skipMessage: 'Wiki API no accesible, saltando',
    outputFile: () => path.join(STATIC, 'wiki-fish.json'),
    summarize: data => `${data.length} peces`,
  },
  {
    id: 'wiki-mutations',
    label: 'Scrapeando mutaciones de la wiki (fischipedia.org)',
    script: 'src/sources/scrape-wiki-mutations.js',
    dependsOn: 'wiki-fish', // skip if wiki was skipped
    outputFile: () => path.join(STATIC, 'mutations-merged.json'),
    summarize: data => `${data.length} mutaciones merged`,
  },
  {
    id: 'merge',
    label: 'Combinando fuentes de peces',
    script: 'src/merge-data.js',
    outputFile: () => path.join(STATIC, 'fish-merged.json'),
    summarize: data => {
      const both = data.filter(f => f.dataSource?.calculator && f.dataSource?.wiki);
      const onlyCalc = data.filter(f => f.dataSource?.calculator && !f.dataSource?.wiki);
      const onlyWiki = data.filter(f => !f.dataSource?.calculator && f.dataSource?.wiki);
      return `${data.length} peces (${both.length} ambas, ${onlyCalc.length} solo calc, ${onlyWiki.length} solo wiki)`;
    },
  },
  {
    id: 'values',
    label: 'Scrapeando valores de trading',
    script: 'src/sources/scrape-values.js',
    outputFile: () => path.join(DYNAMIC, 'trading-values.json'),
    summarize: data => {
      const items = data.items || [];
      const withEstimate = items.filter(i => i.estimatedValue);
      return `${items.length} items (${withEstimate.length} con valor estimado)`;
    },
  },
];

// ---- Runner ----

function runScript(scriptPath, cwd) {
  return new Promise((resolve, reject) => {
    const proc = execFile(NODE, [scriptPath], {
      cwd,
      timeout: 600000, // 10 min max per step
      maxBuffer: 50 * 1024 * 1024, // 50MB
      env: { ...process.env, NODE_OPTIONS: '' },
    }, (err, stdout, stderr) => {
      if (err) {
        reject({ error: err.message, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${remainSecs.toString().padStart(2, '0')}s`;
}

// ---- Main ----

async function main() {
  const startTime = Date.now();
  const errors = [];
  const results = {};
  const skipped = new Set();

  const total = STEPS.length;

  console.log('');
  console.log('  ════════════════════════════════════════');
  console.log('  FISCH DATA SCRAPER - Full Pipeline');
  console.log('  ════════════════════════════════════════');
  console.log('');

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    const num = `[${i + 1}/${total}]`;
    const stepStart = Date.now();

    // Check if dependency was skipped
    if (step.dependsOn && skipped.has(step.dependsOn)) {
      console.log(`${num} ${step.label}... SKIP (dependencia "${step.dependsOn}" saltada)`);
      skipped.add(step.id);
      results[step.id] = { status: 'skipped', reason: `dependency ${step.dependsOn} skipped` };
      continue;
    }

    // Run pre-check if defined
    if (step.preCheck) {
      process.stdout.write(`${num} ${step.label}... (verificando) `);
      const canRun = await step.preCheck();
      if (!canRun) {
        console.log(`SKIP (${step.skipMessage || 'pre-check falló'})`);
        skipped.add(step.id);
        results[step.id] = { status: 'skipped', reason: step.skipMessage || 'pre-check failed' };
        continue;
      }
    } else {
      process.stdout.write(`${num} ${step.label}... `);
    }

    try {
      const { stdout, stderr } = await runScript(step.script, ROOT);
      const elapsed = Date.now() - stepStart;

      // Try to read the output file for summary
      let summary = '';
      if (step.outputFile && step.summarize) {
        const data = readJsonSafe(step.outputFile());
        if (data) {
          summary = step.summarize(data);
        }
      }

      console.log(`OK ${summary ? `(${summary})` : ''} [${formatDuration(elapsed)}]`);
      results[step.id] = { status: 'ok', summary, elapsed };

    } catch (err) {
      const elapsed = Date.now() - stepStart;
      console.log(`ERROR [${formatDuration(elapsed)}]`);

      const errorDetail = {
        step: step.id,
        script: step.script,
        error: err.error || 'unknown',
        stdout: (err.stdout || '').slice(-500),
        stderr: (err.stderr || '').slice(-500),
        elapsed,
      };
      errors.push(errorDetail);
      results[step.id] = { status: 'error', error: err.error };

      // Don't skip dependents on error — let them try anyway
    }
  }

  const totalElapsed = Date.now() - startTime;

  // ---- Read final data for summary ----
  const fishList = readJsonSafe(path.join(STATIC, 'fish-list.json'));
  const fishComplete = readJsonSafe(path.join(STATIC, 'fish-complete.json'));
  const wikiFish = readJsonSafe(path.join(STATIC, 'wiki-fish.json'));
  const fishMerged = readJsonSafe(path.join(STATIC, 'fish-merged.json'));
  const mutations = readJsonSafe(path.join(STATIC, 'mutations.json'));
  const mutationsMerged = readJsonSafe(path.join(STATIC, 'mutations-merged.json'));
  const rods = readJsonSafe(path.join(STATIC, 'rods.json'));
  const locations = readJsonSafe(path.join(STATIC, 'locations.json'));
  const values = readJsonSafe(path.join(DYNAMIC, 'trading-values.json'));

  const calcCount = fishList ? fishList.length : '?';
  const wikiCount = wikiFish ? wikiFish.length : '?';
  const mergedCount = fishMerged ? fishMerged.length : '?';
  const mutCalc = mutations ? mutations.length : '?';
  const mutMerged = mutationsMerged ? mutationsMerged.length : '?';
  const rodCount = rods ? rods.length : '?';
  const locCount = locations ? locations.length : '?';
  const valCount = values?.items ? values.items.length : '?';
  const valEstimate = values?.items ? values.items.filter(i => i.estimatedValue).length : '?';

  const errorCount = errors.length;
  const okCount = Object.values(results).filter(r => r.status === 'ok').length;
  const skipCount = Object.values(results).filter(r => r.status === 'skipped').length;

  // ---- Print summary ----
  console.log('');
  console.log('  ════════════════════════════════════════');
  console.log('  RESUMEN DEL SCRAPING');
  console.log('  ════════════════════════════════════════');
  console.log(`  Peces:       ${calcCount} (calculator) + ${wikiCount} (wiki) = ${mergedCount} merged`);
  console.log(`  Mutaciones:  ${mutCalc} (calculator) -> ${mutMerged} merged`);
  console.log(`  Cañas:       ${rodCount}`);
  console.log(`  Ubicaciones: ${locCount}`);
  console.log(`  Valores:     ${valCount} items (${valEstimate} con valor estimado)`);
  console.log('  ════════════════════════════════════════');
  console.log(`  Pasos:       ${okCount} OK, ${skipCount} saltados, ${errorCount} errores`);
  console.log(`  Tiempo total: ${formatDuration(totalElapsed)}`);

  if (errorCount > 0) {
    console.log(`  Errores: ${errorCount} (ver data/scrape-errors.json)`);
  }
  console.log('  ════════════════════════════════════════');
  console.log('');

  // ---- Save errors log ----
  const errorsFile = path.join(DATA_DIR, 'scrape-errors.json');
  const errorsLog = {
    timestamp: new Date().toISOString(),
    totalSteps: total,
    ok: okCount,
    skipped: skipCount,
    errors: errorCount,
    totalElapsed,
    details: errors,
    stepResults: results,
  };
  fs.writeFileSync(errorsFile, JSON.stringify(errorsLog, null, 2));

  if (errorCount > 0) {
    process.exit(1);
  }

  // ---- Copy to Astro ----
  console.log('  Copiando datos a Astro...');
  try {
    require('./copy-to-astro');
    console.log('  ════════════════════════════════════════');
    console.log('');
  } catch (err) {
    console.error('  [ERROR] copy-to-astro:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
