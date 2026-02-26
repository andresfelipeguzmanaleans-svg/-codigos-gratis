const fetch = require('node-fetch');

const HEADERS_BASE = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};

const HEADERS_FULL = {
  ...HEADERS_BASE,
  'Accept-Language': 'en-US,en;q=0.9',
};

const URLS = [
  {
    label: 'Category:Fish (cmlimit=10)',
    url: 'https://fischipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:Fish&cmlimit=10&format=json',
  },
  {
    label: 'Siteinfo (meta)',
    url: 'https://fischipedia.org/w/api.php?action=query&meta=siteinfo&format=json',
  },
];

async function tryFetch(label, url, headers) {
  const headerDesc = Object.keys(headers).join(', ');
  console.log(`\n--- ${label} ---`);
  console.log(`URL: ${url}`);
  console.log(`Headers: ${headerDesc}`);

  try {
    const res = await fetch(url, { headers, timeout: 15000, redirect: 'follow' });
    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    const text = await res.text();

    // Check for Cloudflare block
    if (text.includes('Cloudflare') || text.includes('cf-browser-verification') || text.includes('challenge-platform')) {
      console.log(`BLOCKED: Cloudflare challenge detected (${text.length} chars HTML)`);
      return false;
    }

    // Try parse as JSON
    try {
      const json = JSON.parse(text);
      console.log('Response JSON:');
      console.log(JSON.stringify(json, null, 2).slice(0, 2000));
      return true;
    } catch {
      console.log(`Not JSON. Body (first 500 chars):\n${text.slice(0, 500)}`);
      return false;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('=== Testing fischipedia.org API access ===\n');

  // Test 1: Category:Fish with base headers
  let ok = await tryFetch(URLS[0].label, URLS[0].url, HEADERS_BASE);

  if (!ok) {
    console.log('\n>> First request failed, trying alternatives...\n');

    // Test 2: Siteinfo with base headers
    ok = await tryFetch(URLS[1].label, URLS[1].url, HEADERS_BASE);

    // Test 3: Category:Fish with full headers
    if (!ok) {
      ok = await tryFetch(URLS[0].label + ' (full headers)', URLS[0].url, HEADERS_FULL);
    }

    // Test 4: Siteinfo with full headers
    if (!ok) {
      ok = await tryFetch(URLS[1].label + ' (full headers)', URLS[1].url, HEADERS_FULL);
    }

    // Test 5: Try with browser-like UA as last resort
    if (!ok) {
      const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      ok = await tryFetch('Siteinfo (browser UA)', URLS[1].url, browserHeaders);
    }
  }

  console.log(`\n=== Result: ${ok ? 'API ACCESSIBLE' : 'API NOT ACCESSIBLE'} ===`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
