/**
 * Enrich locations.json with coordinates and image paths.
 * Reads locations.json + location-coords.json, merges coords into each location.
 *
 * Run AFTER scrape-wiki-locations.js and BEFORE copy-to-astro.js.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'static');

function main() {
  console.log('Enriching locations with coordinates + images...\n');

  const locFile = path.join(DATA_DIR, 'locations.json');
  const coordsFile = path.join(DATA_DIR, 'location-coords.json');

  const locations = JSON.parse(fs.readFileSync(locFile, 'utf8'));

  let coordsData = {};
  if (fs.existsSync(coordsFile)) {
    coordsData = JSON.parse(fs.readFileSync(coordsFile, 'utf8'));
    console.log(`Coords data loaded: ${Object.keys(coordsData).length} entries`);
  } else {
    console.log('No location-coords.json found, skipping coordinate enrichment');
  }

  let withCoords = 0;
  let withImage = 0;

  for (const loc of locations) {
    const data = coordsData[loc.id] || {};

    // Add coordinates (x and z only — top-down map)
    if (data.coords) {
      loc.coords = { x: data.coords.x, z: data.coords.z };
      loc.coordSource = data.coordSource || 'unknown';
      withCoords++;
    } else {
      loc.coords = null;
      loc.coordSource = null;
    }

    // Add image path
    if (data.imagePath) {
      loc.imagePath = data.imagePath;
      withImage++;
    } else {
      loc.imagePath = null;
    }
  }

  // Write back
  fs.writeFileSync(locFile, JSON.stringify(locations, null, 2));

  console.log('\n========================================');
  console.log('Location enrichment complete:');
  console.log(`  Total locations: ${locations.length}`);
  console.log(`  With coords:     ${withCoords}/${locations.length}`);
  console.log(`  With image:      ${withImage}/${locations.length}`);
  console.log('========================================\n');
}

main();
