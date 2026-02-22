/**
 * merge-codes.mjs
 * Reads data/scraped-codes.json and merges found codes into game JSON files.
 * Translates English rewards to Spanish. Does not overwrite existing codes.
 *
 * Usage: node scripts/merge-codes.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const SCRAPED = 'data/scraped-codes.json';
const GAMES_DIR = 'data/games';

// ---------------------------------------------------------------------------
// Reward translation (EN → ES)
// ---------------------------------------------------------------------------

const WORD_MAP = {
  // Currencies
  'free': 'gratis',
  'coins': 'monedas',
  'coin': 'moneda',
  'gems': 'gemas',
  'gem': 'gema',
  'gold': 'oro',
  'cash': 'Cash',
  'bucks': 'Bucks',
  'money': 'dinero',
  'tokens': 'tokens',
  'diamonds': 'diamantes',
  'diamond': 'diamante',
  'crystals': 'cristales',
  'credits': 'créditos',
  'beli': 'Beli',
  'yen': 'Yen',
  'energy': 'energía',
  'points': 'puntos',
  'stars': 'estrellas',

  // Boosts
  'boost': 'Boost',
  'boosts': 'Boosts',
  'double': 'doble',
  'triple': 'triple',
  'minutes': 'minutos',
  'minute': 'minuto',
  'hours': 'horas',
  'hour': 'hora',

  // Items
  'skin': 'skin',
  'skins': 'skins',
  'pet': 'mascota',
  'pets': 'mascotas',
  'crate': 'cofre',
  'crates': 'cofres',
  'chest': 'cofre',
  'chests': 'cofres',
  'key': 'llave',
  'keys': 'llaves',
  'reward': 'recompensa',
  'rewards': 'recompensas',
  'freebies': 'recompensas gratis',
  'free rewards': 'recompensas gratis',
  'item': 'objeto',
  'items': 'objetos',
  'title': 'título',
  'potion': 'poción',
  'potions': 'pociones',
  'ticket': 'ticket',
  'tickets': 'tickets',
  'spin': 'giro',
  'spins': 'giros',
  'roll': 'tirada',
  'rolls': 'tiradas',
  'summon': 'invocación',
  'summons': 'invocaciones',

  // Stats
  'strength': 'fuerza',
  'speed': 'velocidad',
  'defense': 'defensa',
  'damage': 'daño',
  'experience': 'experiencia',
  'stat reset': 'reinicio de stats',
  'reset your stats': 'reiniciar tus stats',
  'stat refund': 'reinicio de stats',

  // Misc
  'gift': 'regalo',
  'luck': 'suerte',
  'in-game': 'del juego',
  'limited': 'limitado',
  'exclusive': 'exclusivo',
  'special': 'especial',
  'rare': 'raro',
  'legendary': 'legendario',
  'epic': 'épico',
  'common': 'común',
};

// Full phrase replacements (checked first, before word-level)
const PHRASE_MAP = {
  'free rewards': 'recompensas gratis',
  'stat reset': 'reinicio de stats',
  'reset your stats': 'reiniciar tus stats',
  'stat refund': 'reinicio de stats',
  'in-game title': 'título del juego',
  'double xp': '2x EXP',
  '2x xp': '2x EXP',
  '2x exp': '2x EXP',
  '3x xp': '3x EXP',
  '2x experience': '2x experiencia',
  '2x coins': '2x monedas',
  'triple coins': 'triple monedas',
  'black dress': 'vestido negro',
  'to be entered into the giveaway': 'participar en el sorteo',
};

function translateReward(text) {
  if (!text) return text;
  let result = text;

  // Unescape any remaining HTML entities
  result = result.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

  // Apply phrase replacements first (case-insensitive)
  for (const [en, es] of Object.entries(PHRASE_MAP)) {
    const regex = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, es);
  }

  // "Free X" → "X gratis" (move gratis after the noun)
  result = result.replace(/\bFree\s+(.+)/i, (_, rest) => rest.trim() + ' gratis');

  // Apply word-level replacements
  for (const [en, es] of Object.entries(WORD_MAP)) {
    const regex = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, es);
  }

  // "gratis gratis" → "gratis"
  result = result.replace(/gratis\s+gratis/gi, 'gratis');

  // Clean up: capitalize first letter
  result = result.charAt(0).toUpperCase() + result.slice(1);

  // Remove trailing periods, brackets, or whitespace
  result = result.replace(/\.\s*$/, '').replace(/\s*\[.*$/, '').trim();

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(SCRAPED)) {
    console.error(`Error: ${SCRAPED} not found. Run scrape-codes-bulk.mjs first.`);
    process.exit(1);
  }

  const scraped = JSON.parse(fs.readFileSync(SCRAPED, 'utf8'));
  console.log(`Loaded ${scraped.length} scraped games from ${SCRAPED}\n`);

  let gamesUpdated = 0;
  let codesAdded = 0;
  let expiredAdded = 0;

  for (const entry of scraped) {
    if (entry.activeCodes.length === 0 && entry.expiredCodes.length === 0) continue;

    // Find the game JSON file
    const gameFile = path.join(GAMES_DIR, `${entry.slug}.json`);
    if (!fs.existsSync(gameFile)) {
      console.log(`  ✗ File not found: ${gameFile}`);
      continue;
    }

    const game = JSON.parse(fs.readFileSync(gameFile, 'utf8'));
    const existingActive = new Set(game.activeCodes.map(c => c.code.toLowerCase()));
    const existingExpired = new Set(game.expiredCodes.map(c => c.code.toLowerCase()));

    let newActive = 0;
    let newExpired = 0;

    // Add new active codes (don't duplicate)
    for (const c of entry.activeCodes) {
      const key = c.code.toLowerCase();
      if (!existingActive.has(key) && !existingExpired.has(key)) {
        game.activeCodes.push({
          code: c.code,
          reward: translateReward(c.reward),
        });
        existingActive.add(key);
        newActive++;
      }
    }

    // Add new expired codes (don't duplicate)
    for (const c of entry.expiredCodes) {
      const key = c.code.toLowerCase();
      if (!existingActive.has(key) && !existingExpired.has(key)) {
        game.expiredCodes.push({
          code: c.code,
          reward: translateReward(c.reward),
        });
        existingExpired.add(key);
        newExpired++;
      }
    }

    if (newActive > 0 || newExpired > 0) {
      // Update lastUpdated
      game.lastUpdated = new Date().toISOString().slice(0, 10);

      if (!dryRun) {
        fs.writeFileSync(gameFile, JSON.stringify(game, null, 2) + '\n', 'utf8');
      }

      console.log(`✓ ${game.name}: +${newActive} active, +${newExpired} expired${dryRun ? ' (dry run)' : ''}`);

      // Show sample translations
      if (newActive > 0) {
        const sample = game.activeCodes.slice(-Math.min(newActive, 3));
        sample.forEach(c => console.log(`    ${c.code} → ${c.reward}`));
      }

      gamesUpdated++;
      codesAdded += newActive;
      expiredAdded += newExpired;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${dryRun ? '[DRY RUN] ' : ''}Merge complete`);
  console.log(`  Games updated: ${gamesUpdated}`);
  console.log(`  Active codes added: ${codesAdded}`);
  console.log(`  Expired codes added: ${expiredAdded}`);
}

main();
