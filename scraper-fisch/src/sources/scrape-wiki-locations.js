/**
 * Scrape location images + coordinates from fischipedia.org wiki.
 *
 * For each location in locations.json:
 * 1. Fetches wiki page images → downloads main image to public/images/locations/
 * 2. Parses wikitext for XYZ coordinates
 * 3. Also checks the "Locations" overview page for a world map image
 *
 * Output: scraper-fisch/data/static/location-coords.json
 *
 * Rate limit: 1 request/second.
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'static');
const IMG_DIR = path.join(__dirname, '..', '..', '..', 'public', 'images', 'locations');
const OUT_FILE = path.join(DATA_DIR, 'location-coords.json');
const MAX_RETRIES = 3;
const DELAY_MS = 1000;
const SAVE_EVERY = 20;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, timeout: 30000 });
      if (!res.ok) {
        if (res.status === 503 || res.headers.get('retry-after')) {
          const wait = parseInt(res.headers.get('retry-after') || '5') * 1000;
          process.stdout.write(` [maxlag, waiting ${wait / 1000}s]`);
          await sleep(wait);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = 1000 * Math.pow(2, attempt - 1);
      process.stdout.write(` [retry ${attempt}]`);
      await sleep(wait);
    }
  }
}

async function downloadImage(url, destPath) {
  try {
    const res = await fetch(url, { headers: HEADERS, timeout: 60000 });
    if (!res.ok) return false;
    const buffer = await res.buffer();
    if (buffer.length < 500) return false; // skip tiny/empty files
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}

// ---- Extract coordinates from wikitext ----

function extractCoordinates(wikitext) {
  if (!wikitext) return null;

  // Pattern 1: {{Coordinates|X|Y|Z}}
  const coordMatch = wikitext.match(/\{\{Coordinates\|([^|]+)\|([^|]+)\|([^}]+)\}\}/);
  if (coordMatch) {
    return {
      x: parseFloat(coordMatch[1]) || 0,
      y: parseFloat(coordMatch[2]) || 0,
      z: parseFloat(coordMatch[3]) || 0,
    };
  }

  // Pattern 2: coordinates = X, Y, Z in infobox
  const infoCoordMatch = wikitext.match(/\|\s*coordinates?\s*=\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
  if (infoCoordMatch) {
    return {
      x: parseFloat(infoCoordMatch[1]) || 0,
      y: parseFloat(infoCoordMatch[2]) || 0,
      z: parseFloat(infoCoordMatch[3]) || 0,
    };
  }

  // Pattern 3: Look for XYZ-like number triplets near "coordinate" or "position" or "location"
  const contextMatch = wikitext.match(/(?:coordinates?|position|located?\s+at)[^\n]*?(-?\d{2,5}(?:\.\d+)?)\s*[,\s]\s*(-?\d{2,5}(?:\.\d+)?)\s*[,\s]\s*(-?\d{2,5}(?:\.\d+)?)/i);
  if (contextMatch) {
    return {
      x: parseFloat(contextMatch[1]) || 0,
      y: parseFloat(contextMatch[2]) || 0,
      z: parseFloat(contextMatch[3]) || 0,
    };
  }

  return null;
}

// ---- Extract main image from wiki page images ----

function pickMainImage(images, pageName) {
  if (!images || images.length === 0) return null;

  const slug = slugify(pageName);

  // Filter out icons, logos, UI elements
  const skip = /icon|logo|ui_|navbox|button|banner|flag|arrow|check|cross|rarity|thumb/i;

  const candidates = images.filter(img => {
    const name = img.toLowerCase();
    if (skip.test(name)) return false;
    if (name.endsWith('.svg')) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Prefer image that contains the location name
  const nameMatch = candidates.find(img =>
    img.toLowerCase().includes(slug.replace(/-/g, '')) ||
    img.toLowerCase().includes(slug.replace(/-/g, '_')) ||
    img.toLowerCase().includes(pageName.toLowerCase().replace(/\s+/g, '_'))
  );
  if (nameMatch) return nameMatch;

  // Otherwise take the first image (usually the infobox image)
  return candidates[0];
}

// ---- Process a single location ----

async function processLocation(name) {
  // Try several wiki page title variants
  const titles = [
    name,
    name.replace(/ /g, '_'),
    name.replace(/'/g, "'"),
  ];

  // Unique titles
  const uniqueTitles = [...new Set(titles)];

  for (const title of uniqueTitles) {
    const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext|images&format=json&maxlag=5`;

    try {
      const json = await fetchJson(url);
      if (json.error) continue;

      const wikitext = json.parse?.wikitext?.['*'] || '';
      const images = json.parse?.images || [];

      const coords = extractCoordinates(wikitext);
      const mainImage = pickMainImage(images, name);

      return { coords, mainImage, wikiTitle: title };
    } catch {
      continue;
    }
  }

  return { coords: null, mainImage: null, wikiTitle: null };
}

// ---- Hardcoded coordinates for major locations ----

const HARDCODED_COORDS = {
  'moosewood': { x: 0, y: 140, z: 0 },
  'mushgrove-swamp': { x: 2790, y: 140, z: -630 },
  'roslit-bay': { x: -1515, y: 140, z: 760 },
  'snowcap-island': { x: 2850, y: 180, z: 2700 },
  'sunstone-island': { x: -930, y: 225, z: -990 },
  'forsaken-shores': { x: -2685, y: 165, z: 1770 },
  'roslit-volcano': { x: -1515, y: 250, z: 760 },
  'ancient-isle': { x: 1800, y: 160, z: -1800 },
  'treasure-island': { x: 500, y: 140, z: -2500 },
  'isle-of-new-beginnings': { x: -200, y: 140, z: 2200 },
  'terrapin-island': { x: 3500, y: 150, z: 500 },
  'lushgrove': { x: 1200, y: 140, z: 1600 },
  'castaway-cliffs': { x: -2000, y: 160, z: -1500 },
  'cursed-isle': { x: 2200, y: 140, z: -2800 },
  'pine-shoals': { x: -3200, y: 140, z: -500 },
  'crystal-cove': { x: 600, y: 130, z: 3200 },
  'lobster-shores': { x: -607, y: 155, z: 2697 },
  // Sea/ocean areas spread around the map
  'the-ocean': { x: 0, y: 0, z: -800 },
  'open-ocean': { x: 500, y: 0, z: -1200 },
  'second-sea': { x: -1000, y: 0, z: 3500 },
  // Underground/special areas near their parent locations
  'the-depths': { x: 0, y: -200, z: 100 },
  'atlantis': { x: 400, y: -500, z: -3000 },
  'desolate-deep': { x: -2685, y: -100, z: 1870 },
  'crimson-cavern': { x: -1515, y: 50, z: 860 },
  'glacial-grotto': { x: 2850, y: 50, z: 2800 },
  'frigid-cavern': { x: 2950, y: 50, z: 2600 },
  'snowburrow': { x: 2750, y: 50, z: 2750 },
  'luminescent-cavern': { x: 1200, y: 50, z: 1700 },
  'lost-jungle': { x: 1100, y: 140, z: 1500 },
  'ancient-archives': { x: 1900, y: 50, z: -1700 },
  'crypt': { x: 2200, y: 50, z: -2700 },
  'emberreach': { x: -1600, y: 50, z: 850 },
  'keepers-altar': { x: -950, y: 50, z: -1050 },
  'azure-lagoon': { x: -600, y: 140, z: 2800 },
  'volcanic-vents': { x: -1450, y: -100, z: 700 },
  'carrot-garden': { x: -250, y: 140, z: 2300 },
  // Pools and special areas
  'kraken-pool': { x: 1850, y: -50, z: -1850 },
  'atlantis-kraken-pool': { x: 450, y: -500, z: -3050 },
  'brine-pool': { x: -2700, y: -50, z: 1820 },
  'ethereal-abyss-pool': { x: 50, y: -300, z: 150 },
  'sunken-depths-pool': { x: 450, y: -400, z: -2950 },
  'poseidon-trial-pool': { x: 500, y: -450, z: -3100 },
  'frightful-pool': { x: 2300, y: -50, z: -2750 },
  // Deep ocean areas
  'challengers-deep': { x: 1500, y: -800, z: -3500 },
  'the-chasm': { x: -500, y: -600, z: -2000 },
  'calm-zone': { x: -1800, y: -300, z: 2800 },
  'abyssal-zenith': { x: -2000, y: -400, z: 2500 },
  'veil-of-the-forsaken': { x: -2800, y: -200, z: 1900 },
  'atlantean-storm': { x: 300, y: -450, z: -3200 },
  'vertigo': { x: 500, y: -700, z: -3300 },
  'cults-curse': { x: 2300, y: -100, z: -2900 },
  'cultist-lair': { x: 2250, y: -50, z: -2850 },
  // Mariana's Veil sub-areas
  'marianas-veil-volcanic-vents': { x: -1500, y: -200, z: 650 },
  'marianas-veil-abyssal-zenith': { x: -2050, y: -400, z: 2550 },
  'marianas-veil-calm-zone': { x: -1850, y: -300, z: 2850 },
  // Second Sea sub-areas
  'second-sea-azure-lagoon': { x: -650, y: 140, z: 2850 },
  'second-sea-waveborne': { x: -1050, y: 140, z: 3400 },
  'waveborne': { x: -1050, y: 140, z: 3400 },
  'cryogenic-canal': { x: 2900, y: 50, z: 2650 },
  // Events (placed at edges/special spots)
  'admin-events': { x: 0, y: 200, z: 0 },
  'fischfright-2025': { x: 2200, y: 140, z: -2800 },
  'winter-village': { x: 2850, y: 180, z: 2700 },
  'lego-event-2025': { x: 0, y: 140, z: 0 },
  'fischgiving-2025': { x: 0, y: 140, z: 0 },
  // Misc
  'unknown': { x: 0, y: 0, z: 0 },
  'oceanic-trench': { x: 1000, y: -600, z: -3000 },
  'monster-trench': { x: 1200, y: -700, z: -3200 },
  'ocean': { x: 0, y: 0, z: -800 },
  'executive-lake': { x: 100, y: 140, z: 200 },
  'grand-reef': { x: -800, y: -100, z: 1000 },
  'mariana-trench': { x: -1800, y: -500, z: 2600 },
  'salty-reef': { x: -500, y: -50, z: 1500 },
};

// ---- Check for world map image ----

async function checkWorldMap() {
  console.log('Checking for world map image on Locations page...');

  const url = `${API}?action=parse&page=Locations&prop=images&format=json&maxlag=5`;
  try {
    const json = await fetchJson(url);
    if (json.error) {
      console.log('  No "Locations" page found');
      return null;
    }

    const images = json.parse?.images || [];
    console.log(`  Found ${images.length} images on Locations page`);

    // Look for map-related images
    const mapImages = images.filter(img => {
      const lower = img.toLowerCase();
      return lower.includes('map') || lower.includes('world') || lower.includes('overview');
    });

    if (mapImages.length > 0) {
      console.log(`  Map candidates: ${mapImages.join(', ')}`);
      const mapFile = mapImages[0];
      const imgUrl = `https://fischipedia.org/wiki/Special:FilePath/${encodeURIComponent(mapFile)}`;
      const destPath = path.join(IMG_DIR, 'world-map.png');
      const ok = await downloadImage(imgUrl, destPath);
      if (ok) {
        console.log(`  Downloaded world map: ${mapFile}`);
        return mapFile;
      }
    }

    // Also try "Map" page directly
    const mapPageUrl = `${API}?action=parse&page=Map&prop=images&format=json&maxlag=5`;
    try {
      const mapJson = await fetchJson(mapPageUrl);
      if (!mapJson.error) {
        const mapPageImages = mapJson.parse?.images || [];
        console.log(`  Found ${mapPageImages.length} images on Map page`);
        for (const img of mapPageImages) {
          const lower = img.toLowerCase();
          if (lower.includes('map') || lower.includes('world') || lower.includes('overview') || lower.includes('fisch')) {
            const imgUrl = `https://fischipedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}`;
            const destPath = path.join(IMG_DIR, 'world-map.png');
            const ok = await downloadImage(imgUrl, destPath);
            if (ok) {
              console.log(`  Downloaded world map from Map page: ${img}`);
              return img;
            }
          }
        }
      }
    } catch {}

    console.log('  No world map image found');
    return null;
  } catch (err) {
    console.log(`  Error checking world map: ${err.message}`);
    return null;
  }
}

// ---- Main ----

async function main() {
  console.log('Scraping location images + coordinates from fischipedia.org\n');

  // Ensure dirs exist
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Load locations
  const locFile = path.join(DATA_DIR, 'locations.json');
  if (!fs.existsSync(locFile)) {
    console.error('locations.json not found');
    process.exit(1);
  }
  const locations = JSON.parse(fs.readFileSync(locFile, 'utf8'));
  console.log(`Locations to process: ${locations.length}\n`);

  // Check for world map first
  const worldMap = await checkWorldMap();
  await sleep(DELAY_MS);

  // Load existing progress
  let results = {};
  if (fs.existsSync(OUT_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      console.log(`\nResuming: ${Object.keys(results).length} already processed`);
    } catch {
      results = {};
    }
  }

  const stats = { wikiCoords: 0, hardcoded: 0, noCoords: 0, images: 0, cached: 0, errors: 0 };

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const slug = loc.id || slugify(loc.name);

    // Skip already processed
    if (results[slug] && results[slug].imageDownloaded !== undefined) {
      stats.cached++;
      continue;
    }

    const label = `[${i + 1}/${locations.length}]`;
    process.stdout.write(`${label} ${loc.name}...`);

    try {
      const data = await processLocation(loc.name);

      // Determine coordinates: wiki > hardcoded
      let coords = null;
      let coordSource = 'none';

      if (data.coords) {
        coords = data.coords;
        coordSource = 'wiki';
        stats.wikiCoords++;
      } else if (HARDCODED_COORDS[slug]) {
        coords = HARDCODED_COORDS[slug];
        coordSource = 'hardcoded';
        stats.hardcoded++;
      } else {
        stats.noCoords++;
      }

      // Download image
      let imageDownloaded = false;
      if (data.mainImage) {
        const ext = path.extname(data.mainImage).toLowerCase() || '.png';
        const imgUrl = `https://fischipedia.org/wiki/Special:FilePath/${encodeURIComponent(data.mainImage)}`;
        const destPath = path.join(IMG_DIR, slug + ext);
        imageDownloaded = await downloadImage(imgUrl, destPath);
        if (imageDownloaded) stats.images++;
      }

      results[slug] = {
        coords,
        coordSource,
        wikiTitle: data.wikiTitle,
        mainImage: data.mainImage,
        imageDownloaded,
        imagePath: imageDownloaded ? `/images/locations/${slug}${path.extname(data.mainImage || '.png').toLowerCase()}` : null,
      };

      console.log(` ${coordSource}${imageDownloaded ? ' +img' : ''}`);
    } catch (err) {
      stats.errors++;
      console.log(` ERROR: ${err.message}`);
      results[slug] = {
        coords: HARDCODED_COORDS[slug] || null,
        coordSource: HARDCODED_COORDS[slug] ? 'hardcoded' : 'none',
        wikiTitle: null,
        mainImage: null,
        imageDownloaded: false,
        imagePath: null,
      };
    }

    // Save progress
    if ((i + 1) % SAVE_EVERY === 0) {
      fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
      process.stdout.write(`  [saved: ${Object.keys(results).length}]\n`);
    }

    await sleep(DELAY_MS);
  }

  // Final save
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));

  // Stats
  console.log('\n========================================');
  console.log('Location scrape complete:');
  console.log(`  Total entries:   ${Object.keys(results).length}`);
  console.log(`  Wiki coords:     ${stats.wikiCoords}`);
  console.log(`  Hardcoded coords: ${stats.hardcoded}`);
  console.log(`  No coords:       ${stats.noCoords}`);
  console.log(`  Images:          ${stats.images}`);
  console.log(`  Cached:          ${stats.cached}`);
  console.log(`  Errors:          ${stats.errors}`);
  console.log(`  World map:       ${worldMap || 'not found'}`);
  console.log(`\nSaved to ${OUT_FILE}`);
  console.log('========================================\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
