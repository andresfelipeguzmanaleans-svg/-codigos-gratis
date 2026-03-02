const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BASE_DIR = 'C:/Users/santi/Desktop/PROYECTOS VS CODE/WEB CODIGOS-GRATIS';
const OUT_DIR = path.join(BASE_DIR, 'public/images/locations');
const LOC_JSON = path.join(BASE_DIR, 'src/data/games/fisch/locations.json');
const TMP_DIR = path.join(BASE_DIR, 'scraper-fisch/data/tmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

fs.mkdirSync(TMP_DIR, { recursive: true });

// Mapping: location id -> { url: wiki image URL, filename: output filename }
// Some locations can reuse existing images on disk
const IMAGE_MAP = {
  // Sub-locations with direct wiki images
  'roslit-volcano':       { url: 'https://static.wikitide.net/fischwiki/8/80/RoslitVolcano.png', filename: 'roslit-volcano.png' },
  'volcanic-vents':       { url: 'https://static.wikitide.net/fischwiki/7/79/Volcanic_Vents.png', filename: 'volcanic-vents.png' },
  'brine-pool':           { url: 'https://static.wikitide.net/fischwiki/4/49/BrinePool.png', filename: 'brine-pool.png' },
  'snowburrow':           { url: 'https://static.wikitide.net/fischwiki/e/ee/Snowburrow.png', filename: 'snowburrow.png' },
  'glacial-grotto':       { url: 'https://static.wikitide.net/fischwiki/a/a2/GlacialGrotto.png', filename: 'glacial-grotto.png' },
  'frigid-cavern':        { url: 'https://static.wikitide.net/fischwiki/2/2d/FrigidCavern.png', filename: 'frigid-cavern.png' },
  'carrot-garden':        { url: 'https://static.wikitide.net/fischwiki/b/b7/Carrot_Garden.png', filename: 'carrot-garden.png' },
  'cults-curse':          { url: 'https://static.wikitide.net/fischwiki/4/46/CultsCurse.png', filename: 'cults-curse.png' },
  'crypt':                { url: 'https://static.wikitide.net/fischwiki/a/ab/CryptEntrance.png', filename: 'crypt.png' },
  'frightful-pool':       { url: 'https://static.wikitide.net/fischwiki/b/bc/FrightfulPool.png', filename: 'frightful-pool.png' },
  'keepers-altar':        { url: 'https://static.wikitide.net/fischwiki/1/19/KeepersAltar.png', filename: 'keepers-altar.png' },
  'ancient-archives':     { url: 'https://static.wikitide.net/fischwiki/e/e4/AncientArchives.png', filename: 'ancient-archives.png' },
  'kraken-pool':          { url: 'https://static.wikitide.net/fischwiki/1/10/Kraken_Pool.png', filename: 'kraken-pool.png' },
  'atlantean-storm':      { url: 'https://static.wikitide.net/fischwiki/4/4b/AtlanteanStorm.png', filename: 'atlantean-storm.png' },
  'calm-zone':            { url: 'https://static.wikitide.net/fischwiki/2/29/Calm_Zone.png', filename: 'calm-zone.png' },
  'veil-of-the-forsaken': { url: 'https://static.wikitide.net/fischwiki/e/eb/ForsakenVeil.png', filename: 'veil-of-the-forsaken.png' },
  'challengers-deep':     { url: 'https://static.wikitide.net/fischwiki/7/78/Challenger_Deep.png', filename: 'challengers-deep.png' },
  'ethereal-abyss-pool':  { url: 'https://static.wikitide.net/fischwiki/4/4b/Ethereal_Abyss.png', filename: 'ethereal-abyss-pool.png' },
  'sunken-depths-pool':   { url: 'https://static.wikitide.net/fischwiki/f/f8/Sunken_Depths.png', filename: 'sunken-depths-pool.png' },
  'poseidon-trial-pool':  { url: 'https://static.wikitide.net/fischwiki/4/46/Poseidon_Temple.png', filename: 'poseidon-trial-pool.png' },

  // Deep ocean / Mariana sub-zones
  'marianas-veil-volcanic-vents': { url: 'https://static.wikitide.net/fischwiki/e/ee/MarianasVeil.png', filename: 'marianas-veil.png' },
  'marianas-veil-abyssal-zenith': { existing: 'marianas-veil.png' },
  'marianas-veil-calm-zone':      { existing: 'marianas-veil.png' },
  'mariana-trench':                { existing: 'marianas-veil.png' },

  // Atlantis sub-zones (reuse existing atlantis.png)
  'atlantis-kraken-pool':        { existing: 'atlantis.png' },
  'atlantis-sunken-depths-pool': { existing: 'atlantis.png' },

  // Second Sea sub-zones (reuse existing images)
  'second-sea':               { existing: 'waveborne.png' },
  'second-sea-waveborne':     { existing: 'waveborne.png' },
  'second-sea-azure-lagoon':  { existing: 'azure-lagoon.png' },

  // The Ocean (reuse ocean.png)
  'the-ocean':   { existing: 'ocean.png' },

  // Event locations
  'winter-village':   { url: 'https://static.wikitide.net/fischwiki/e/ea/WinterVillage.png', filename: 'winter-village.png' },
  'lego-event-2025':  { url: 'https://static.wikitide.net/fischwiki/1/15/LEGO_Event.png', filename: 'lego-event-2025.png' },
  'fischgiving-2025': { url: 'https://static.wikitide.net/fischwiki/4/4b/Fischgiving_2025.png', filename: 'fischgiving-2025.png' },
  'fischfright-2025': { url: 'https://static.wikitide.net/fischwiki/3/3a/Halloween_Roped.png', filename: 'fischfright-2025.png' },

  // No image available - will skip
  // 'unknown', 'admin-events', 'the-chasm', 'cryogenic-canal', 'abyssal-zenith',
  // 'oceanic-trench', 'monster-trench', 'executive-lake', 'salty-reef'
};

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doRequest = (url, redirects) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(url, { headers: { 'User-Agent': UA }, timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redir = res.headers.location;
          if (redir.startsWith('/')) {
            const u = new URL(url);
            redir = u.protocol + '//' + u.host + redir;
          }
          res.resume();
          return doRequest(redir, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        const ws = fs.createWriteStream(destPath);
        res.pipe(ws);
        ws.on('finish', () => { ws.close(); resolve(); });
        ws.on('error', reject);
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
    };
    doRequest(url, 0);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Scrape Missing Location Images ===\n');

  const locations = JSON.parse(fs.readFileSync(LOC_JSON, 'utf8'));
  const missing = locations.filter(l => l.imagePath === null);
  console.log('Locations with null imagePath: ' + missing.length);

  let downloaded = 0, reused = 0, skipped = 0, failed = 0;
  const updates = {}; // id -> imagePath

  for (const loc of missing) {
    const mapping = IMAGE_MAP[loc.id];
    if (!mapping) {
      console.log('  SKIP  ' + loc.id + ' (no image source)');
      skipped++;
      continue;
    }

    // If reusing an existing image
    if (mapping.existing) {
      const existPath = path.join(OUT_DIR, mapping.existing);
      if (fs.existsSync(existPath)) {
        updates[loc.id] = '/images/locations/' + mapping.existing;
        console.log('  REUSE ' + loc.id + ' -> ' + mapping.existing);
        reused++;
      } else {
        console.log('  MISS  ' + loc.id + ' (existing file not found: ' + mapping.existing + ')');
        skipped++;
      }
      continue;
    }

    // Download from wiki
    const outFile = path.join(OUT_DIR, mapping.filename);
    if (fs.existsSync(outFile)) {
      updates[loc.id] = '/images/locations/' + mapping.filename;
      console.log('  EXISTS ' + loc.id + ' -> ' + mapping.filename);
      reused++;
      continue;
    }

    const tmpFile = path.join(TMP_DIR, mapping.filename);
    try {
      await downloadFile(mapping.url, tmpFile);
      const stats = fs.statSync(tmpFile);
      if (stats.size < 1000) {
        console.log('  TINY  ' + loc.id + ' (' + stats.size + ' bytes)');
        fs.unlinkSync(tmpFile);
        failed++;
        continue;
      }

      // Resize with ffmpeg to 640x360
      try {
        execSync(
          'ffmpeg -y -i "' + tmpFile + '" -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0" -frames:v 1 "' + outFile + '" -loglevel error',
          { stdio: 'pipe', timeout: 30000 }
        );
        updates[loc.id] = '/images/locations/' + mapping.filename;
        console.log('  OK    ' + loc.id + ' -> ' + mapping.filename + ' (' + Math.round(stats.size / 1024) + 'KB)');
        downloaded++;
      } catch (ffErr) {
        // If ffmpeg fails, just copy the original
        fs.copyFileSync(tmpFile, outFile);
        updates[loc.id] = '/images/locations/' + mapping.filename;
        console.log('  COPY  ' + loc.id + ' -> ' + mapping.filename + ' (ffmpeg failed, copied original)');
        downloaded++;
      }
    } catch (err) {
      console.log('  FAIL  ' + loc.id + ' - ' + err.message);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      failed++;
    }

    await sleep(500);
  }

  // Update locations.json
  console.log('\n--- Updating locations.json ---');
  let updated = 0;
  for (const loc of locations) {
    if (updates[loc.id]) {
      loc.imagePath = updates[loc.id];
      updated++;
    }
  }

  fs.writeFileSync(LOC_JSON, JSON.stringify(locations, null, 2));
  console.log('Updated ' + updated + ' locations in JSON');

  console.log('\n=== RESULTS ===');
  console.log('Downloaded: ' + downloaded);
  console.log('Reused:     ' + reused);
  console.log('Skipped:    ' + skipped);
  console.log('Failed:     ' + failed);
  console.log('JSON updated: ' + updated);
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
