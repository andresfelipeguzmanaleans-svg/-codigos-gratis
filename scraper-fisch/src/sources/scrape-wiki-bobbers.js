const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://fischipedia.org/w/api.php';
const HEADERS = {
  'User-Agent': 'FischDataBot/1.0 (https://codigos-gratis.com; bot de datos)',
  'Accept': 'application/json',
};
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'static');
const MAX_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS, timeout: 30000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function cleanWikitext(text) {
  if (!text) return '';
  let s = text;
  s = s.replace(/\{\{[Ii]tem\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Rarity\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{C\$\|([^}]+)\}\}/g, 'C$$1');
  s = s.replace(/\{\{Robux\|([^}]+)\}\}/g, '$1 Robux');
  s = s.replace(/\{\{LC\$\|([^|}]+)\|([^}]+)\}\}/g, '$1 $2');
  s = s.replace(/\{\{[^|}]+\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'{2,3}/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ');
  return s.trim();
}

function normalizeRarity(cssClass) {
  if (!cssClass) return null;
  const rarityMap = {
    'trash': 'Trash', 'common': 'Common', 'uncommon': 'Uncommon',
    'unusual': 'Unusual', 'rare': 'Rare', 'legendary': 'Legendary',
    'mythic': 'Mythical', 'mythical': 'Mythical', 'apex': 'Apex',
    'secret': 'Secret', 'exotic': 'Exotic', 'special': 'Special',
    'limited': 'Limited', 'event': 'Event',
  };
  const match = cssClass.match(/rarity-(\w+)/);
  if (!match) return null;
  return rarityMap[match[1].toLowerCase()] || match[1];
}

/**
 * Parse a wikitext table into rows with their attributes and cells.
 * Handles: || separators, multi-line * bullets, rowspan propagation.
 */
function parseWikiTable(tableText) {
  const rawRows = tableText.split(/\n\|-/);
  const rows = [];

  for (const rawRow of rawRows) {
    const lines = rawRow.split('\n');
    const attrLine = lines[0].trim();

    const cellLines = [];
    let isHeader = false;
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('!')) {
        isHeader = true;
        break;
      }
      if (trimmed.startsWith('|') && !trimmed.startsWith('|-') && !trimmed.startsWith('|+') && !trimmed.startsWith('|}')) {
        cellLines.push(lines[i].replace(/^\|\s*/, ''));
      } else if (trimmed.startsWith('*')) {
        // Bullet continuation — append to last cell
        if (cellLines.length > 0) {
          cellLines[cellLines.length - 1] += '\n' + lines[i];
        }
      }
    }
    if (isHeader || cellLines.length === 0) continue;

    const fullRow = cellLines.join(' || ');
    const cells = fullRow.split(/\s*\|\|\s*/).map(c => c.trim());

    rows.push({ attrs: attrLine, cells });
  }

  return rows;
}

/**
 * Extract cell value, handling rowspan="N" | value pattern.
 * Returns { value, rowspan }
 */
function extractCell(cellText) {
  if (!cellText) return { value: '', rowspan: 0 };
  const rsMatch = cellText.match(/^rowspan="(\d+)"\s*\|\s*([\s\S]*)/);
  if (rsMatch) {
    return { value: rsMatch[2].trim(), rowspan: parseInt(rsMatch[1]) };
  }
  return { value: cellText.trim(), rowspan: 0 };
}

function parseBobberTables(wikitext) {
  const bobbers = [];

  const tableRegex = /\{\|\s*class="wikitable[^"]*"([\s\S]*?)\|\}/g;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(wikitext)) !== null) {
    const tableContent = tableMatch[1];

    // Caption — grab full text after |+ and clean wiki markup
    const captionMatch = tableContent.match(/\|\+\s*(.+)/);
    const caption = captionMatch ? cleanWikitext(captionMatch[1]).trim() : '';

    // Category
    let category = 'Other';
    if (/bestiary/i.test(caption) && !/rod mastery/i.test(caption)) category = 'Bestiary';
    else if (/rod mastery/i.test(caption)) category = 'Rod Mastery';
    else if (/limited/i.test(caption)) category = 'Limited';
    else if (/event/i.test(caption)) category = 'Event';
    else if (/gamepass/i.test(caption)) category = 'Gamepass';
    else if (/available shop/i.test(caption)) category = 'Shop (Weekly)';
    else if (/unavailable shop/i.test(caption)) category = 'Shop (Weekly)';
    else if (/bobber pack/i.test(caption)) category = 'Shop (Pack)';
    else if (/bundle/i.test(caption)) category = 'Shop (Bundle)';
    else if (/merch/i.test(caption)) category = 'Merch';
    else if (/never obtainable|unobtainable/i.test(caption)) category = 'Unobtainable';

    // Detect if table has Event column (4 columns)
    const headerMatch = tableContent.match(/!\s*(.+)/);
    const headers = headerMatch
      ? headerMatch[1].split('!!').map(h => cleanWikitext(h).trim().toLowerCase())
      : [];
    const hasEventCol = headers.includes('event');

    const rows = parseWikiTable(tableContent);

    // Track rowspan values for source/notes/event columns
    let prevSource = null, sourceSpan = 0;
    let prevNotes = null, notesSpan = 0;
    let prevEvent = null, eventSpan = 0;

    for (const row of rows) {
      const { attrs, cells } = row;
      if (cells.length < 1) continue;

      // Rarity from CSS class
      const rarity = normalizeRarity(attrs);

      // Name from first cell
      const nameMatch = cells[0].match(/\{\{[Ii]tem\|([^|}]+)/);
      const name = nameMatch ? nameMatch[1].trim() : cleanWikitext(cells[0]).trim();
      if (!name || /^name$/i.test(name)) continue;

      // Parse remaining cells with rowspan tracking
      let source, notes, event;
      let cellIdx = 1;

      if (cells.length > cellIdx) {
        const sc = extractCell(cells[cellIdx++]);
        if (sc.rowspan > 0) { prevSource = sc.value; sourceSpan = sc.rowspan - 1; }
        else if (sc.value) { prevSource = sc.value; sourceSpan = 0; }
        source = sc.value || null;
      } else if (sourceSpan > 0) {
        source = prevSource;
        sourceSpan--;
      } else {
        source = null;
      }

      if (hasEventCol) {
        if (cells.length > cellIdx) {
          const ec = extractCell(cells[cellIdx++]);
          if (ec.rowspan > 0) { prevEvent = ec.value; eventSpan = ec.rowspan - 1; }
          else if (ec.value) { prevEvent = ec.value; eventSpan = 0; }
          event = ec.value || null;
        } else if (eventSpan > 0) {
          event = prevEvent;
          eventSpan--;
        } else {
          event = null;
        }
      }

      if (cells.length > cellIdx) {
        const nc = extractCell(cells[cellIdx++]);
        if (nc.rowspan > 0) { prevNotes = nc.value; notesSpan = nc.rowspan - 1; }
        else if (nc.value) { prevNotes = nc.value; notesSpan = 0; }
        notes = nc.value || null;
      } else if (notesSpan > 0) {
        notes = prevNotes;
        notesSpan--;
      } else {
        notes = null;
      }

      bobbers.push({
        name,
        slug: slugify(name),
        rarity: rarity || null,
        category,
        source: source ? cleanWikitext(source) : null,
        event: event ? cleanWikitext(event) : null,
        notes: notes ? cleanWikitext(notes) : null,
        imageUrl: `https://fischipedia.org/wiki/Special:FilePath/${encodeURIComponent(name.replace(/ /g, '_'))}_Bobber.png`,
        wikiSource: 'fischipedia.org',
      });
    }
  }

  return bobbers;
}

async function main() {
  console.log('Scraping bobbers from fischipedia.org\n');

  process.stdout.write('Fetching Bobbers page wikitext...');
  const url = `${API}?action=parse&page=Bobbers&prop=wikitext&format=json&maxlag=5`;
  const json = await fetchJson(url);
  const wikitext = json.parse.wikitext['*'];
  console.log(` OK (${wikitext.length} chars)`);

  const bobbers = parseBobberTables(wikitext);

  const byCategory = {};
  bobbers.forEach(b => { byCategory[b.category] = (byCategory[b.category] || 0) + 1; });

  const byRarity = {};
  bobbers.forEach(b => {
    const r = b.rarity || 'Unknown';
    byRarity[r] = (byRarity[r] || 0) + 1;
  });

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, 'bobbers.json');
  fs.writeFileSync(outFile, JSON.stringify(bobbers, null, 2));

  const withSource = bobbers.filter(b => b.source);
  const withNotes = bobbers.filter(b => b.notes);
  const withRarity = bobbers.filter(b => b.rarity);
  const withEvent = bobbers.filter(b => b.event);

  console.log('\n========================================');
  console.log(`Total bobbers: ${bobbers.length}`);

  console.log('\nPor categoría:');
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    console.log(`  ${c}: ${n}`);
  });

  console.log('\nPor rareza:');
  Object.entries(byRarity).sort((a, b) => b[1] - a[1]).forEach(([r, n]) => {
    console.log(`  ${r}: ${n}`);
  });

  console.log('\nCampos extraídos:');
  console.log(`  name:     ${bobbers.length}/${bobbers.length}`);
  console.log(`  rarity:   ${withRarity.length}/${bobbers.length}`);
  console.log(`  category: ${bobbers.length}/${bobbers.length}`);
  console.log(`  source:   ${withSource.length}/${bobbers.length}`);
  console.log(`  event:    ${withEvent.length}/${bobbers.length}`);
  console.log(`  notes:    ${withNotes.length}/${bobbers.length}`);

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
