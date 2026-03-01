const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// Configuration
const BASE_DIR = 'C:/Users/santi/Desktop/PROYECTOS VS CODE/WEB CODIGOS-GRATIS';
const ORIGINALS_DIR = path.join(BASE_DIR, 'scraper-fisch/data/images/locations-wiki');
const RESIZED_DIR = path.join(BASE_DIR, 'public/images/locations/wiki');
const TMPDIR = path.join(process.env.USERPROFILE, 'tmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Create directories
fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
fs.mkdirSync(RESIZED_DIR, { recursive: true });
fs.mkdirSync(TMPDIR, { recursive: true });

// Slug function
function toSlug(wikiTitle) {
  let name = wikiTitle.replace(/^File:/, '');
  const lastDot = name.lastIndexOf('.');
  let ext = '';
  let base = name;
  if (lastDot !== -1) {
    ext = name.substring(lastDot).toLowerCase();
    base = name.substring(0, lastDot);
  }
  let slug = base
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug + ext;
}

// HTTP GET with redirect following
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const doRequest = (url, redirectCount) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { headers: { 'User-Agent': UA }, timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsed = new URL(url);
            redirectUrl = parsed.protocol + '//' + parsed.host + redirectUrl;
          }
          res.resume();
          doRequest(redirectUrl, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        fileStream.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    };
    doRequest(url, 0);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Fischipedia Location Context Images Scraper ===\n');

  // Step 1: Fetch category members
  console.log('[Step 1] Fetching file list from MediaWiki API...');
  const apiUrl = 'https://fischipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Location_Context_Images&cmlimit=500&format=json';
  const apiFile = path.join(TMPDIR, 'wiki_page1.json');

  await downloadFile(apiUrl, apiFile);
  const data = JSON.parse(fs.readFileSync(apiFile, 'utf8'));
  const allMembers = data.query.categorymembers;
  console.log(`  Total category members: ${allMembers.length}`);

  // Filter out Balloon files
  const files = allMembers.filter(m => !m.title.startsWith('File:Balloon'));
  console.log(`  Non-Balloon files: ${files.length}\n`);

  // Step 2 & 3: Download and resize
  console.log('[Step 2] Downloading and processing images...\n');

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;
  const failedFiles = [];

  for (let i = 0; i < files.length; i++) {
    const member = files[i];
    const wikiFilename = member.title.replace(/^File:/, '');
    const slugFilename = toSlug(member.title);
    const origPath = path.join(ORIGINALS_DIR, slugFilename);
    const resizedPath = path.join(RESIZED_DIR, slugFilename);

    // Check if already done
    if (fs.existsSync(resizedPath)) {
      skipped++;
      // Print skip message every 50 files to avoid too much spam
      if (skipped % 50 === 0) {
        console.log(`  SKIP (${skipped} skipped so far)`);
      }
      continue;
    }

    const encodedName = encodeURIComponent(wikiFilename).replace(/%20/g, ' ');
    const downloadUrl = `https://fischipedia.org/wiki/Special:FilePath/${encodedName}`;

    try {
      // Download
      await downloadFile(downloadUrl, origPath);

      // Check file size
      const stats = fs.statSync(origPath);
      if (stats.size < 5000) {
        console.log(`  FAIL (${i + 1}/${files.length}) ${slugFilename} - too small (${stats.size} bytes)`);
        fs.unlinkSync(origPath);
        failed++;
        failedFiles.push({ name: slugFilename, reason: `too small (${stats.size} bytes)` });
        await sleep(1000);
        continue;
      }

      // Resize with ffmpeg
      try {
        execSync(
          `ffmpeg -y -i "${origPath}" -vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=black@0" -frames:v 1 "${resizedPath}" -loglevel error`,
          { stdio: 'pipe', timeout: 30000 }
        );
        downloaded++;
        console.log(`  OK   (${downloaded}/${files.length - skipped}) ${slugFilename} (${Math.round(stats.size / 1024)}KB)`);
      } catch (ffErr) {
        console.log(`  FAIL (${i + 1}/${files.length}) ${slugFilename} - ffmpeg error: ${ffErr.message}`);
        try { fs.unlinkSync(resizedPath); } catch(e) {}
        failed++;
        failedFiles.push({ name: slugFilename, reason: 'ffmpeg error' });
      }
    } catch (err) {
      console.log(`  FAIL (${i + 1}/${files.length}) ${slugFilename} - ${err.message}`);
      try { fs.unlinkSync(origPath); } catch(e) {}
      failed++;
      failedFiles.push({ name: slugFilename, reason: err.message });
    }

    // Polite delay
    await sleep(1000);
  }

  console.log('\n=== RESULTS ===');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped:    ${skipped}`);
  console.log(`Failed:     ${failed}`);
  console.log(`Total:      ${files.length}`);

  if (failedFiles.length > 0) {
    console.log('\nFailed files:');
    failedFiles.forEach(f => console.log(`  - ${f.name}: ${f.reason}`));
  }

  // Calculate sizes
  try {
    const origFiles = fs.readdirSync(ORIGINALS_DIR);
    const origSize = origFiles.reduce((sum, f) => sum + fs.statSync(path.join(ORIGINALS_DIR, f)).size, 0);
    const resizedFiles = fs.readdirSync(RESIZED_DIR);
    const resizedSize = resizedFiles.reduce((sum, f) => sum + fs.statSync(path.join(RESIZED_DIR, f)).size, 0);

    console.log(`\nOriginals: ${origFiles.length} files, ${(origSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`Resized:   ${resizedFiles.length} files, ${(resizedSize / 1024 / 1024).toFixed(1)} MB`);
  } catch(e) {
    console.log('\nCould not calculate sizes:', e.message);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
