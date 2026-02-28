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
  s = s.replace(/\{\{Enchantment\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{Mutation\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{Item\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Weather\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{Rarity\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{C\$\|([^}]+)\}\}/g, 'C$$1');
  s = s.replace(/\{\{Event\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{Robux\|([^}]+)\}\}/g, '$1 Robux');
  s = s.replace(/\{\{PlayerTitle\|([^}]+)\}\}/g, '$1');
  s = s.replace(/\{\{LC\$\|([^|}]+)\|([^}]+)\}\}/g, '$1 $2');
  s = s.replace(/\{\{[^|}]+\|([^|}]+)[^}]*\}\}/g, '$1');
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/'{2,3}/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  return s.trim();
}

/**
 * Split a wikitext table into rows, then parse each row's cells.
 * Handles || separators and multi-line cell content (e.g. * bullet lines).
 */
function parseWikiTable(tableText) {
  // Split by |- to get rows
  const rawRows = tableText.split(/\n\|-/);
  const rows = [];

  for (const rawRow of rawRows) {
    const lines = rawRow.split('\n');
    // First line has row attributes (class, id, etc.)
    const attrLine = lines[0].trim();

    // Collect cell content lines (start with | but not |- or |+ or |})
    const cellLines = [];
    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('|') && !trimmed.startsWith('|-') && !trimmed.startsWith('|+') && !trimmed.startsWith('|}')) {
        cellLines.push(lines[i].replace(/^\|\s*/, ''));
      } else if (trimmed.startsWith('!')) {
        // Header row - skip
        break;
      } else if (trimmed.startsWith('*')) {
        // Continuation line (bullet point) — append to last cell line
        if (cellLines.length > 0) {
          cellLines[cellLines.length - 1] += '\n' + lines[i];
        }
      }
    }
    if (cellLines.length === 0) continue;

    // Join and split by ||
    const fullRow = cellLines.join(' || ');
    const cells = fullRow.split(/\s*\|\|\s*/).map(c => c.trim());

    // Strip rowspan/colspan from cell content
    const cleanedCells = cells.map(c => c.replace(/^rowspan="\d+"\s*\|\s*/, '').replace(/^colspan="\d+"\s*\|\s*/, ''));

    rows.push({ attrs: attrLine, cells: cleanedCells });
  }

  return rows;
}

function parseEnchantmentTables(wikitext) {
  const enchantments = [];

  // Extract tables
  const tableRegex = /\{\|\s*class="wikitable[^"]*"([\s\S]*?)\|\}/g;
  let tableMatch;

  while ((tableMatch = tableRegex.exec(wikitext)) !== null) {
    const tableContent = tableMatch[1];

    // Get caption — grab full text after |+ and clean wiki markup
    const captionMatch = tableContent.match(/\|\+\s*(.+)/);
    const caption = captionMatch ? cleanWikitext(captionMatch[1]).trim() : '';

    // Determine type
    let type = null;
    if (/regular/i.test(caption)) type = 'Regular';
    else if (/exalted/i.test(caption)) type = 'Exalted';
    else if (/cosmic/i.test(caption)) type = 'Cosmic';
    else if (/twisted/i.test(caption)) type = 'Twisted';
    else if (/quest/i.test(caption)) type = 'Quest';
    else if (/limited/i.test(caption)) type = 'Limited';
    // Skip any table that doesn't match a known type (e.g. Value Boost Comparison)
    if (!type) continue;

    // Detect columns from header row
    const headerMatch = tableContent.match(/!\s*(.+)/);
    if (!headerMatch) continue;
    const headers = headerMatch[1].split('!!').map(h => cleanWikitext(h).trim().toLowerCase());
    const hasTypeCol = headers.includes('type');

    const rows = parseWikiTable(tableContent);

    for (const row of rows) {
      const { cells } = row;
      if (cells.length < 2) continue;

      // First cell: name (contains {{Enchantment|Name}})
      const nameMatch = cells[0].match(/\{\{Enchantment\|([^}]+)\}\}/);
      const name = nameMatch ? nameMatch[1].trim() : cleanWikitext(cells[0]).trim();
      if (!name || name.toLowerCase() === 'name') continue; // skip header

      let cellIdx = 1;
      let effect, tips, enchType, obtainment;

      if (type === 'Limited' && hasTypeCol) {
        // Limited: Name || Type || Effect || Tips || Obtainment
        enchType = cleanWikitext(cells[cellIdx++] || '').trim();
        effect = cleanWikitext(cells[cellIdx++] || '').trim();
        tips = cleanWikitext(cells[cellIdx++] || '').trim() || null;
        obtainment = cleanWikitext(cells[cellIdx++] || '').trim() || null;
      } else if (type === 'Quest') {
        // Quest: Name || Effect || Tips || Obtainment
        effect = cleanWikitext(cells[cellIdx++] || '').trim();
        tips = cleanWikitext(cells[cellIdx++] || '').trim() || null;
        obtainment = cleanWikitext(cells[cellIdx++] || '').trim() || null;
      } else {
        // Regular/Exalted/Cosmic/Twisted: Name || Effect || Tips
        effect = cleanWikitext(cells[cellIdx++] || '').trim();
        tips = cleanWikitext(cells[cellIdx++] || '').trim() || null;
      }

      const entry = {
        name,
        slug: slugify(name),
        type,
        effect: effect || null,
        tips: tips || null,
        obtainment: obtainment || null,
        imageUrl: `https://fischipedia.org/wiki/Special:FilePath/Enchanting.png`,
        source: 'fischipedia.org',
      };
      // For Limited enchantments, the Type column says Primary/Secondary
      if (enchType) entry.subType = enchType;
      enchantments.push(entry);
    }
  }

  return enchantments;
}

async function main() {
  console.log('Scraping enchantments from fischipedia.org\n');

  process.stdout.write('Fetching Enchanting page wikitext...');
  const url = `${API}?action=parse&page=Enchanting&prop=wikitext&format=json&maxlag=5`;
  const json = await fetchJson(url);
  const wikitext = json.parse.wikitext['*'];
  console.log(` OK (${wikitext.length} chars)`);

  const enchantments = parseEnchantmentTables(wikitext);

  const byType = {};
  enchantments.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, 'enchantments.json');
  fs.writeFileSync(outFile, JSON.stringify(enchantments, null, 2));

  console.log('\n========================================');
  console.log(`Total enchantments: ${enchantments.length}`);
  console.log('\nPor tipo:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`  ${t}: ${n}`);
  });

  const withEffect = enchantments.filter(e => e.effect);
  const withTips = enchantments.filter(e => e.tips);
  const withObtain = enchantments.filter(e => e.obtainment);

  console.log('\nCampos extraídos:');
  console.log(`  name:       ${enchantments.length}/${enchantments.length}`);
  console.log(`  type:       ${enchantments.length}/${enchantments.length}`);
  console.log(`  effect:     ${withEffect.length}/${enchantments.length}`);
  console.log(`  tips:       ${withTips.length}/${enchantments.length}`);
  console.log(`  obtainment: ${withObtain.length}/${enchantments.length}`);

  console.log(`\nGuardado en ${outFile}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
