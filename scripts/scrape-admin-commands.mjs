/**
 * Scrape Roblox Admin Commands from bloxodes.com
 *
 * Usage:
 *   node scripts/scrape-admin-commands.mjs
 */

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'data', 'admin-commands.json');
const PUBLIC_OUTPUT = resolve(__dirname, '..', 'public', 'data', 'admin-commands.json');

const SYSTEMS = [
  {
    name: 'HD Admin',
    slug: 'hd-admin',
    url: 'https://bloxodes.com/catalog/admin-commands/hd-admin',
    prefix: ';',
    description:
      'HD Admin es uno de los sistemas de comandos más populares de Roblox. Con más de 150 comandos organizados en 17 categorías, ofrece herramientas para moderar servidores, personalizar personajes y mucho más. Es ideal para administradores que buscan un panel visual con GUI integrado.',
  },
  {
    name: "Kohl's Admin",
    slug: 'kohls-admin',
    url: 'https://bloxodes.com/catalog/admin-commands/kohls-admin',
    prefix: ';',
    description:
      "Kohl's Admin es un sistema de administración clásico y ampliamente utilizado en Roblox con más de 250 comandos. Organizado en 9 categorías de roles, permite desde controlar el entorno del juego hasta moderar jugadores y ejecutar comandos divertidos.",
  },
  {
    name: 'Basic Admin Essentials',
    slug: 'basic-admin',
    url: 'https://bloxodes.com/catalog/admin-commands/basic-admin',
    prefix: '!',
    description:
      'Basic Admin Essentials (BAE) es un sistema de administración ligero y eficiente para Roblox. Con 100 comandos distribuidos en 5 niveles de permisos, es ideal para servidores que buscan moderación sencilla y sin complicaciones.',
  },
  {
    name: 'Adonis Admin',
    slug: 'adonis-admin',
    url: 'https://bloxodes.com/catalog/admin-commands/adonis-admin',
    prefix: ':',
    description:
      'Adonis Admin es el sistema con más comandos de Roblox, con más de 500 comandos distribuidos en categorías basadas en roles. Ofrece herramientas de moderación avanzada, comandos divertidos y opciones de personalización para todo tipo de servidor.',
  },
];

function unescapeHtml(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function prettifySlug(slug) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Extract commands from the page HTML.
 *
 * The page renders commands as plain HTML cards inside category sections.
 * Each category section has an `id="category-slug"` and contains an <h2> or <h3> heading.
 * Each command card has class "rounded-2xl border border-border/60 bg-surface/60 p-4 shadow-sm".
 */
function extractCommands(html) {
  const commands = [];
  const categoryNames = [];

  // --- Strategy A: Find category boundaries via section id attributes ---
  // The HTML has: <div id="ability" class="space-y-4 scroll-mt-24">
  // followed by a heading with the display name
  const catBoundaryRe = /id="([a-z][\w-]*)"[^>]*class="[^"]*space-y-4[^"]*scroll-mt-24[^"]*"/g;
  const catPositions = [];
  let cm;
  while ((cm = catBoundaryRe.exec(html)) !== null) {
    const slug = cm[1];
    // Find the display name in a heading near this position
    const nearby = html.substring(cm.index, cm.index + 500);
    const headingMatch = nearby.match(/<h[23][^>]*>([^<]+)<\/h[23]>/);
    const displayName = headingMatch ? headingMatch[1].trim() : prettifySlug(slug);
    catPositions.push({ slug, name: displayName, index: cm.index });
  }

  // --- Strategy B: If no category sections found, treat entire page as one category ---
  if (catPositions.length === 0) {
    catPositions.push({ slug: 'general', name: 'General', index: 0 });
  }

  // For each category region, extract commands
  for (let i = 0; i < catPositions.length; i++) {
    const start = catPositions[i].index;
    const end = i + 1 < catPositions.length ? catPositions[i + 1].index : html.length;
    const section = html.substring(start, end);
    const catName = catPositions[i].name;

    if (!categoryNames.includes(catName)) categoryNames.push(catName);

    // Split section by card boundary
    const cardDelimiter = 'rounded-2xl border border-border/60 bg-surface/60 p-4 shadow-sm';
    const chunks = section.split(cardDelimiter);

    for (let j = 1; j < chunks.length; j++) {
      const chunk = chunks[j];

      // Command name
      const nameMatch = chunk.match(/font-mono text-xl font-semibold[^>]*>([^<]+)/);
      if (!nameMatch) continue;
      const command = nameMatch[1].trim();

      // Syntax from aria-label
      const syntaxMatch = chunk.match(/aria-label="Copy code ([^"]*)"/);
      const syntax = syntaxMatch ? unescapeHtml(syntaxMatch[1].trim()) : command;

      // Aliases
      const aliasMatch = chunk.match(/Aliases<\/span><span class="ml-2">([^<]+)/);
      const aliases = aliasMatch
        ? aliasMatch[1]
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
        : [];

      // Description
      const descMatch = chunk.match(/text-sm leading-relaxed text-muted">([^<]+)/);
      const description = descMatch ? unescapeHtml(descMatch[1].trim()) : '';

      // Argument badges
      const argMatches = [...chunk.matchAll(/text-\[11px\] font-semibold text-accent">([^<]+)/g)];
      const args = argMatches.map((m) => m[1].trim());

      commands.push({ command, syntax, aliases, description, category: catName, args });
    }
  }

  return { commands, categories: categoryNames };
}

async function fetchHtml(system) {
  // Check for local temp file first
  const tempPath = resolve(__dirname, '..', `bloxodes-${system.slug}-temp.html`);
  if (existsSync(tempPath)) {
    console.log(`  Using local file: bloxodes-${system.slug}-temp.html`);
    return readFileSync(tempPath, 'utf-8');
  }

  console.log(`  Fetching: ${system.url}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(system.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  console.log('Scraping Roblox Admin Commands from Bloxodes...\n');

  const result = {
    totalCommands: 0,
    lastUpdated: new Date().toISOString().slice(0, 10),
    systems: [],
  };

  for (const sys of SYSTEMS) {
    console.log(`Processing ${sys.name}...`);
    const html = await fetchHtml(sys);
    console.log(`  HTML length: ${html.length}`);

    const { commands, categories } = extractCommands(html);

    result.systems.push({
      name: sys.name,
      slug: sys.slug,
      description: sys.description,
      prefix: sys.prefix,
      commandCount: commands.length,
      categories,
      commands,
    });
    result.totalCommands += commands.length;

    console.log(`  Found ${commands.length} commands in ${categories.length} categories`);
    console.log(`  Categories: ${categories.join(', ')}`);
  }

  // Write output
  mkdirSync(dirname(OUTPUT), { recursive: true });
  mkdirSync(dirname(PUBLIC_OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(result, null, 2), 'utf-8');
  copyFileSync(OUTPUT, PUBLIC_OUTPUT);

  console.log(`\n=== DONE ===`);
  console.log(`Total: ${result.totalCommands} commands`);
  console.log(`Saved to: ${OUTPUT}`);
  console.log(`Copied to: ${PUBLIC_OUTPUT}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
