import { useState, useMemo, useEffect, useRef } from 'react';

/* ================================================================
   FischWorldMap — Hand-crafted SVG world map for Fisch
   ================================================================ */

// ---- Types ----
interface FishEntry { name: string; rarity: string; id?: string; }
interface MapLocation {
  id: string; name: string; fishCount: number;
  isPremium: boolean; isEvent: boolean; isSeasonal: boolean;
  coords: { x: number; z: number } | null;
  imagePath: string | null; fish: FishEntry[]; availableWeathers: string[];
}
interface Props { locations: MapLocation[]; gameSlug: string; }

// ---- Rarity ----
const RARITY_ORDER: Record<string, number> = {
  'Divine Secret':17,'Gemstone':16,'Fragment':15,'Relic':14,'Apex':13,
  'Special':12,'Limited':11,'Extinct':10,'Secret':9,'Exotic':8,
  'Mythical':7,'Legendary':6,'Rare':5,'Unusual':4,'Uncommon':3,'Common':2,'Trash':1,
};
const RARITY_COLORS: Record<string, string> = {
  'Trash':'#808080','Common':'#B0B0B0','Uncommon':'#2ECC71','Unusual':'#A3D977',
  'Rare':'#3498DB','Legendary':'#F39C12','Mythical':'#9B59B6','Exotic':'#E74C3C',
  'Secret':'#1ABC9C','Relic':'#CD7F32','Fragment':'#E056A0','Gemstone':'#00FFFF',
  'Extinct':'#5D6D7E','Limited':'#FFD700','Apex':'#FF4500','Special':'#FF69B4',
  'Divine Secret':'#FFE066',
};
function slugify(n: string) { return n.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function bestRarity(fish: FishEntry[]) {
  let b = 'Common', bo = 0;
  for (const f of fish) { const o = RARITY_ORDER[f.rarity]||0; if (o > bo) { bo = o; b = f.rarity; } }
  return b;
}

// ---- SVG Constants ----
const W = 1200, H = 720;

// ---- Biome colors ----
const BIOME: Record<string, { fill: string; stroke: string; accent: string }> = {
  tropical:    { fill: '#1a5c2a', stroke: '#2d8a42', accent: '#3cb371' },
  volcanic:    { fill: '#6b2020', stroke: '#a03030', accent: '#e25555' },
  snow:        { fill: '#8ab4c8', stroke: '#b0d4e8', accent: '#e8f4ff' },
  swamp:       { fill: '#2a4a20', stroke: '#3d6830', accent: '#5a8a40' },
  desert:      { fill: '#9a7830', stroke: '#c4a040', accent: '#e8c860' },
  mysterious:  { fill: '#3a2060', stroke: '#5a3090', accent: '#8855cc' },
  ocean:       { fill: '#14365a', stroke: '#1d5080', accent: '#2d80c0' },
  cave:        { fill: '#2a2040', stroke: '#403060', accent: '#6050a0' },
  ruins:       { fill: '#4a4030', stroke: '#6a6050', accent: '#908060' },
  starter:     { fill: '#1a6030', stroke: '#2a8848', accent: '#40b868' },
  cursed:      { fill: '#4a1030', stroke: '#702040', accent: '#a03060' },
  ice:         { fill: '#405880', stroke: '#6080b0', accent: '#90b8e0' },
  event:       { fill: '#504010', stroke: '#806020', accent: '#c09030' },
};

// ---- Island shape paths (centered at 0,0) ----
// Large islands ~70-80 units wide
const SHAPE_LG_TROPICAL = "M-38,8 C-40,-5 -32,-18 -20,-20 C-12,-24 -4,-16 4,-22 C16,-20 26,-18 34,-14 C42,-6 40,6 36,12 C28,20 12,22 -4,20 C-22,22 -36,16 -38,8Z";
const SHAPE_LG_VOLCANIC = "M-32,14 C-36,4 -28,-8 -18,-14 L-8,-28 L0,-38 L6,-30 L16,-14 C24,-6 34,4 30,14 C24,22 -26,22 -32,14Z";
const SHAPE_LG_SNOW = "M-36,12 C-38,0 -30,-14 -18,-18 L-10,-32 L-4,-26 L2,-34 L8,-24 L14,-16 C24,-10 36,-2 34,12 C28,22 -30,22 -36,12Z";

// Medium islands ~45-55 units
const SHAPE_MD = "M-24,6 C-26,-4 -18,-14 -8,-16 C0,-18 10,-14 18,-10 C26,-4 28,4 24,10 C18,16 -16,16 -24,6Z";
const SHAPE_MD_SWAMP = "M-26,8 C-28,-2 -22,-10 -14,-14 C-8,-16 -2,-12 4,-16 C12,-14 20,-8 24,-2 C28,6 22,14 12,16 C0,18 -10,16 -18,12 C-24,10 -26,8 -26,8Z";
const SHAPE_MD_DESERT = "M-28,6 C-30,-2 -24,-10 -14,-12 C-4,-14 6,-10 16,-12 C26,-8 30,-2 28,6 C24,12 -24,12 -28,6Z";
const SHAPE_MD_RUINS = "M-22,8 C-24,-2 -20,-12 -10,-16 C-2,-18 8,-14 16,-12 C24,-6 22,4 18,10 C10,16 -14,14 -22,8Z";

// Small islands ~25-35 units
const SHAPE_SM = "M-16,4 C-18,-4 -12,-10 -4,-12 C4,-12 12,-8 16,-2 C18,4 12,10 0,12 C-12,10 -18,6 -16,4Z";
const SHAPE_SM_ROCK = "M-14,6 C-16,-2 -10,-10 -2,-12 C6,-12 14,-6 14,0 C14,8 6,12 -2,12 C-10,10 -16,8 -14,6Z";

// Tiny dot for sub-locations
const SHAPE_DOT = "M-8,0 A8,8 0 1,1 8,0 A8,8 0 1,1 -8,0Z";

// ---- Hand-crafted island positions on the 1200x720 canvas ----
type IslandDef = {
  x: number; y: number; shape: string; biome: string;
  scale?: number; label?: string; sea?: 'first' | 'second' | 'deep';
  decoration?: 'trees' | 'volcano' | 'snow_peak' | 'mushrooms' | 'cactus' | 'crystal';
};

const ISLAND_MAP: Record<string, IslandDef> = {
  // === FIRST SEA — CENTER ===
  'moosewood':                { x: 520, y: 290, shape: SHAPE_LG_TROPICAL, biome: 'starter', scale: 1.1, sea: 'first', decoration: 'trees' },
  'isle-of-new-beginnings':   { x: 430, y: 245, shape: SHAPE_SM, biome: 'starter', scale: 0.9, sea: 'first', decoration: 'trees' },
  'the-ocean':                { x: 520, y: 190, shape: SHAPE_DOT, biome: 'ocean', scale: 1.2, label: 'The Ocean', sea: 'first' },
  'waveborne':                { x: 580, y: 355, shape: SHAPE_SM, biome: 'ocean', scale: 0.8, sea: 'first' },
  'vertigo':                  { x: 460, y: 380, shape: SHAPE_SM_ROCK, biome: 'mysterious', scale: 0.85, sea: 'first' },
  'the-depths':               { x: 560, y: 415, shape: SHAPE_SM_ROCK, biome: 'cave', scale: 0.9, sea: 'first' },
  'ethereal-abyss-pool':      { x: 505, y: 255, shape: SHAPE_DOT, biome: 'mysterious', scale: 0.6, sea: 'first' },
  'executive-lake':           { x: 540, y: 260, shape: SHAPE_DOT, biome: 'ocean', scale: 0.5, sea: 'first' },
  'ocean':                    { x: 370, y: 400, shape: SHAPE_DOT, biome: 'ocean', scale: 0.7, label: 'Ocean', sea: 'first' },

  // === FIRST SEA — WEST ===
  'roslit-bay':               { x: 240, y: 310, shape: SHAPE_LG_VOLCANIC, biome: 'volcanic', scale: 0.95, sea: 'first', decoration: 'volcano' },
  'roslit-volcano':           { x: 210, y: 270, shape: SHAPE_SM_ROCK, biome: 'volcanic', scale: 0.7, sea: 'first' },
  'volcanic-vents':           { x: 215, y: 340, shape: SHAPE_DOT, biome: 'volcanic', scale: 0.6, sea: 'first' },
  'marianas-veil---volcanic-vents': { x: 195, y: 335, shape: SHAPE_DOT, biome: 'volcanic', scale: 0.4, sea: 'first' },

  // === FIRST SEA — FAR WEST ===
  'forsaken-shores':          { x: 100, y: 400, shape: SHAPE_MD_DESERT, biome: 'desert', scale: 0.9, sea: 'first', decoration: 'cactus' },
  'grand-reef':               { x: 115, y: 270, shape: SHAPE_SM, biome: 'ocean', scale: 0.75, sea: 'first' },
  'atlantis':                 { x: 55, y: 330, shape: SHAPE_MD_RUINS, biome: 'ruins', scale: 0.85, sea: 'deep' },
  'veil-of-the-forsaken':     { x: 90, y: 435, shape: SHAPE_DOT, biome: 'mysterious', scale: 0.6, sea: 'first' },
  'brine-pool':               { x: 80, y: 410, shape: SHAPE_DOT, biome: 'ocean', scale: 0.5, sea: 'first' },

  // === FIRST SEA — NORTHWEST ===
  'sunstone-island':          { x: 355, y: 170, shape: SHAPE_MD, biome: 'desert', scale: 0.85, sea: 'first' },
  'keepers-altar':            { x: 380, y: 195, shape: SHAPE_DOT, biome: 'ruins', scale: 0.55, sea: 'first' },

  // === FIRST SEA — NORTH / DEEP NORTH ===
  'open-ocean':               { x: 570, y: 110, shape: SHAPE_SM, biome: 'ocean', scale: 0.7, sea: 'first' },
  'castaway-cliffs':          { x: 630, y: 80, shape: SHAPE_SM_ROCK, biome: 'tropical', scale: 0.7, sea: 'first' },
  'desolate-deep':            { x: 420, y: 60, shape: SHAPE_SM_ROCK, biome: 'mysterious', scale: 0.8, sea: 'deep', decoration: 'crystal' },
  'the-chasm':                { x: 470, y: 105, shape: SHAPE_DOT, biome: 'cave', scale: 0.7, sea: 'deep' },

  // === FIRST SEA — EAST ===
  'lushgrove':                { x: 710, y: 220, shape: SHAPE_MD, biome: 'tropical', scale: 0.85, sea: 'first', decoration: 'trees' },
  'pine-shoals':              { x: 730, y: 310, shape: SHAPE_SM, biome: 'tropical', scale: 0.75, sea: 'first', decoration: 'trees' },
  'emberreach':               { x: 850, y: 210, shape: SHAPE_SM_ROCK, biome: 'volcanic', scale: 0.75, sea: 'first' },
  'mushgrove-swamp':          { x: 860, y: 250, shape: SHAPE_MD_SWAMP, biome: 'swamp', scale: 0.75, sea: 'first', decoration: 'mushrooms' },
  'cursed-isle':              { x: 900, y: 370, shape: SHAPE_MD, biome: 'cursed', scale: 0.8, sea: 'first' },
  'ancient-isle':             { x: 1090, y: 280, shape: SHAPE_MD_RUINS, biome: 'ruins', scale: 0.9, sea: 'first' },

  // === FIRST SEA — SOUTH ===
  'terrapin-island':          { x: 420, y: 455, shape: SHAPE_MD, biome: 'tropical', scale: 0.85, sea: 'first', decoration: 'trees' },
  'carrot-garden':            { x: 395, y: 500, shape: SHAPE_SM, biome: 'tropical', scale: 0.6, sea: 'first' },

  // === SOUTHEAST — SNOW AREA ===
  'snowcap-island':           { x: 930, y: 480, shape: SHAPE_LG_SNOW, biome: 'snow', scale: 1.0, sea: 'first', decoration: 'snow_peak' },
  'azure-lagoon':             { x: 805, y: 445, shape: SHAPE_SM, biome: 'ocean', scale: 0.7, sea: 'first' },
  'crystal-cove':             { x: 835, y: 490, shape: SHAPE_SM_ROCK, biome: 'ice', scale: 0.6, sea: 'first' },
  'snowburrow':               { x: 960, y: 520, shape: SHAPE_DOT, biome: 'snow', scale: 0.55, sea: 'first' },
  'glacial-grotto':           { x: 985, y: 545, shape: SHAPE_DOT, biome: 'ice', scale: 0.5, sea: 'first' },
  'frigid-cavern':            { x: 1000, y: 515, shape: SHAPE_DOT, biome: 'ice', scale: 0.45, sea: 'first' },
  'cryogenic-canal':          { x: 975, y: 500, shape: SHAPE_DOT, biome: 'ice', scale: 0.4, sea: 'first' },

  // === CAVES / DEEP ===
  'crimson-cavern':           { x: 310, y: 55, shape: SHAPE_DOT, biome: 'volcanic', scale: 0.6, sea: 'deep' },
  'luminescent-cavern':       { x: 335, y: 80, shape: SHAPE_DOT, biome: 'mysterious', scale: 0.6, sea: 'deep' },
  'lost-jungle':              { x: 145, y: 85, shape: SHAPE_SM, biome: 'tropical', scale: 0.65, sea: 'deep' },
  'ancient-archives':         { x: 830, y: 130, shape: SHAPE_DOT, biome: 'ruins', scale: 0.55, sea: 'deep' },
  'kraken-pool':              { x: 770, y: 95, shape: SHAPE_DOT, biome: 'cave', scale: 0.55, sea: 'deep' },
  'salty-reef':               { x: 430, y: 430, shape: SHAPE_DOT, biome: 'ocean', scale: 0.45, sea: 'first' },

  // === DEEP TRENCHES ===
  'mariana-trench':           { x: 195, y: 510, shape: SHAPE_DOT, biome: 'cave', scale: 0.6, sea: 'deep' },
  'abyssal-zenith':           { x: 160, y: 530, shape: SHAPE_DOT, biome: 'cave', scale: 0.5, sea: 'deep' },
  'marianas-veil---abyssal-zenith': { x: 145, y: 545, shape: SHAPE_DOT, biome: 'cave', scale: 0.35, sea: 'deep' },
  'calm-zone':                { x: 175, y: 550, shape: SHAPE_DOT, biome: 'ocean', scale: 0.5, sea: 'deep' },
  'marianas-veil---calm-zone':{ x: 160, y: 565, shape: SHAPE_DOT, biome: 'ocean', scale: 0.35, sea: 'deep' },
  'oceanic-trench':           { x: 700, y: 50, shape: SHAPE_DOT, biome: 'cave', scale: 0.5, sea: 'deep' },
  'monster-trench':           { x: 740, y: 35, shape: SHAPE_DOT, biome: 'cave', scale: 0.5, sea: 'deep' },
  'challengers-deep':         { x: 770, y: 55, shape: SHAPE_DOT, biome: 'cave', scale: 0.55, sea: 'deep' },
  'sunken-depths-pool':       { x: 510, y: 55, shape: SHAPE_DOT, biome: 'cave', scale: 0.5, sea: 'deep' },
  'atlantis-kraken-pool':     { x: 495, y: 40, shape: SHAPE_DOT, biome: 'cave', scale: 0.45, sea: 'deep' },
  'poseidon-trial-pool':      { x: 530, y: 40, shape: SHAPE_DOT, biome: 'ruins', scale: 0.45, sea: 'deep' },
  'atlantean-storm':          { x: 490, y: 70, shape: SHAPE_DOT, biome: 'ocean', scale: 0.5, sea: 'deep' },
  'the-crypt':                { x: 860, y: 80, shape: SHAPE_DOT, biome: 'cave', scale: 0.5, sea: 'deep' },
  'cults-curse':              { x: 880, y: 60, shape: SHAPE_DOT, biome: 'cursed', scale: 0.45, sea: 'deep' },
  'frightful-pool':           { x: 870, y: 95, shape: SHAPE_DOT, biome: 'cursed', scale: 0.4, sea: 'deep' },
  'cultist-lair':             { x: 1130, y: 50, shape: SHAPE_DOT, biome: 'cursed', scale: 0.55, sea: 'deep' },

  // === SECOND SEA ===
  'second-sea':               { x: 350, y: 615, shape: SHAPE_SM, biome: 'ocean', scale: 0.8, sea: 'second' },
  'second-sea---waveborne':   { x: 400, y: 640, shape: SHAPE_DOT, biome: 'ocean', scale: 0.55, sea: 'second' },
  'second-sea---azure-lagoon':{ x: 300, y: 600, shape: SHAPE_DOT, biome: 'ocean', scale: 0.55, sea: 'second' },
  'treasure-island':          { x: 1140, y: 630, shape: SHAPE_SM_ROCK, biome: 'desert', scale: 0.7, sea: 'second' },

  // === EVENTS ===
  'admin-events':             { x: 560, y: 335, shape: SHAPE_DOT, biome: 'event', scale: 0.35, sea: 'first' },
  'fischfright-2025':         { x: 870, y: 105, shape: SHAPE_DOT, biome: 'cursed', scale: 0.55, sea: 'first' },
  'winter-village':           { x: 960, y: 545, shape: SHAPE_DOT, biome: 'snow', scale: 0.55, sea: 'first' },
  'lego-event-2025':          { x: 560, y: 645, shape: SHAPE_DOT, biome: 'event', scale: 0.5, sea: 'first' },
  'fischgiving-2025':         { x: 520, y: 660, shape: SHAPE_DOT, biome: 'event', scale: 0.45, sea: 'first' },
};

// Sea route connections (pairs of island IDs)
const ROUTES: [string, string][] = [
  ['moosewood', 'roslit-bay'], ['moosewood', 'sunstone-island'],
  ['moosewood', 'lushgrove'], ['moosewood', 'terrapin-island'],
  ['moosewood', 'isle-of-new-beginnings'], ['moosewood', 'waveborne'],
  ['roslit-bay', 'forsaken-shores'], ['roslit-bay', 'atlantis'],
  ['lushgrove', 'pine-shoals'], ['lushgrove', 'emberreach'],
  ['pine-shoals', 'cursed-isle'], ['cursed-isle', 'ancient-isle'],
  ['emberreach', 'mushgrove-swamp'],
  ['terrapin-island', 'vertigo'], ['vertigo', 'the-depths'],
  ['snowcap-island', 'azure-lagoon'], ['snowcap-island', 'crystal-cove'],
  ['sunstone-island', 'open-ocean'], ['open-ocean', 'castaway-cliffs'],
  ['second-sea', 'treasure-island'],
];

// ---- Island decoration sub-elements ----
function TreeDeco({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <line x1="0" y1="0" x2="0" y2="-8" stroke="#3a2518" strokeWidth="2"/>
      <circle cx="0" cy="-11" r="5" fill="#2d8a42" opacity="0.8"/>
    </g>
  );
}
function VolcanoDeco({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-3,0 L0,-12 L3,0Z" fill="#a03030" opacity="0.7"/>
      <circle cx="0" cy="-14" r="3" fill="#ff6030" opacity="0.4">
        <animate attributeName="opacity" values="0.2;0.6;0.2" dur="3s" repeatCount="indefinite"/>
      </circle>
    </g>
  );
}
function SnowPeak({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-5,0 L0,-14 L5,0Z" fill="#b0d4e8" opacity="0.6"/>
      <path d="M-3,-5 L0,-14 L3,-5Z" fill="#e8f4ff" opacity="0.7"/>
    </g>
  );
}
function MushroomDeco({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <line x1="0" y1="0" x2="0" y2="-6" stroke="#6a5a3a" strokeWidth="1.5"/>
      <ellipse cx="0" cy="-8" rx="4" ry="3" fill="#9a5aaa" opacity="0.7"/>
    </g>
  );
}
function CactusDeco({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <line x1="0" y1="0" x2="0" y2="-10" stroke="#3a7a30" strokeWidth="2"/>
      <line x1="0" y1="-6" x2="-4" y2="-8" stroke="#3a7a30" strokeWidth="1.5"/>
      <line x1="0" y1="-4" x2="3" y2="-6" stroke="#3a7a30" strokeWidth="1.5"/>
    </g>
  );
}
function CrystalDeco({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-2,0 L0,-10 L2,0Z" fill="#8855cc" opacity="0.6"/>
      <path d="M2,0 L4,-7 L5,0Z" fill="#6050a0" opacity="0.5"/>
    </g>
  );
}

const DECO_MAP: Record<string, typeof TreeDeco> = {
  trees: TreeDeco, volcano: VolcanoDeco, snow_peak: SnowPeak,
  mushrooms: MushroomDeco, cactus: CactusDeco, crystal: CrystalDeco,
};

// ---- Main component ----
export default function FischWorldMap({ locations, gameSlug }: Props) {
  const locMap = useMemo(() => {
    const m = new Map<string, MapLocation>();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

  const [filter, setFilter] = useState<'all'|'first'|'second'|'event'>('all');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // URL param
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (loc && locMap.has(loc)) setSelId(loc);
  }, [locMap]);

  // Scroll to panel on select
  useEffect(() => {
    if (selId && panelRef.current) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }, [selId]);

  const selected = selId ? locMap.get(selId) || null : null;

  // Filtered island IDs
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    const entries = Object.entries(ISLAND_MAP);
    for (const [id, def] of entries) {
      const loc = locMap.get(id);
      // Filter by sea
      if (filter === 'first' && (def.sea === 'second')) continue;
      if (filter === 'second' && def.sea !== 'second') continue;
      if (filter === 'event' && !(loc?.isEvent)) continue;
      // Filter by search
      if (search) {
        const q = search.toLowerCase();
        const name = loc?.name || def.label || id;
        const matchName = name.toLowerCase().includes(q);
        const matchFish = loc?.fish.some(f => f.name.toLowerCase().includes(q));
        if (!matchName && !matchFish) continue;
      }
      ids.add(id);
    }
    return ids;
  }, [filter, search, locMap]);

  const selectedFish = useMemo(() => {
    if (!selected) return [];
    let fish = [...selected.fish].sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selected, rarityFilter]);

  const selectedRarities = useMemo(() => {
    if (!selected) return [];
    const r = new Set(selected.fish.map(f => f.rarity));
    return Array.from(r).sort((a, b) => (RARITY_ORDER[b]||0) - (RARITY_ORDER[a]||0));
  }, [selected]);

  const handleClick = (id: string) => {
    setSelId(prev => prev === id ? null : id);
    setRarityFilter(null);
  };

  // ---- Render ----
  return (
    <div className="fwm">
      {/* Toolbar */}
      <div className="fwm-bar">
        <div className="fwm-srch">
          <svg className="fwm-srch__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search island or fish..." value={search} onChange={e => setSearch(e.target.value)} className="fwm-srch__in"/>
          {search && <button onClick={() => setSearch('')} className="fwm-srch__x">&times;</button>}
        </div>
        <div className="fwm-chips">
          {(['all','first','second','event'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`fwm-ch${filter===f?' fwm-ch--on':''}`}>
              {f==='all'?'All':f==='first'?'First Sea':f==='second'?'Second Sea':'Events'}
            </button>
          ))}
          <span className="fwm-cnt">{visibleIds.size} locations</span>
        </div>
      </div>

      {/* SVG Map */}
      <div className="fwm-map">
        <svg viewBox={`0 0 ${W} ${H}`} className="fwm-svg">
          <defs>
            {/* Ocean gradient */}
            <linearGradient id="oc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0a1628"/><stop offset="100%" stopColor="#0f2847"/>
            </linearGradient>
            {/* Glow */}
            <filter id="gl" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            {/* Text shadow */}
            <filter id="ts" x="-15%" y="-15%" width="130%" height="130%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.8"/>
            </filter>
            {/* Selection glow */}
            <filter id="sg" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="6" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Ocean background */}
          <rect x="0" y="0" width={W} height={H} fill="url(#oc)"/>

          {/* Nautical grid */}
          {Array.from({length:12}, (_,i) => (
            <g key={`gr${i}`} opacity="0.04">
              <line x1={i*100+50} y1="0" x2={i*100+50} y2={H} stroke="#4488bb" strokeWidth="0.5"/>
              <line x1="0" y1={i*60+30} x2={W} y2={i*60+30} stroke="#4488bb" strokeWidth="0.5"/>
            </g>
          ))}

          {/* Ocean waves */}
          {[120, 280, 440, 580].map((y, i) => (
            <path key={`w${i}`} d={`M0,${y} Q150,${y-8} 300,${y} T600,${y} T900,${y} T1200,${y}`}
              fill="none" stroke="#1d5a8a" strokeWidth="0.8" opacity="0.05"/>
          ))}

          {/* Sea labels */}
          <text x={520} y={160} textAnchor="middle" fill="#2a6090" fontSize="18" fontFamily="Inter,system-ui,sans-serif" fontWeight="700" letterSpacing="8" opacity="0.12">FIRST SEA</text>
          <text x={380} y={590} textAnchor="middle" fill="#2a6090" fontSize="14" fontFamily="Inter,system-ui,sans-serif" fontWeight="700" letterSpacing="6" opacity="0.1">SECOND SEA</text>

          {/* Sea routes */}
          {ROUTES.map(([a, b], i) => {
            const pa = ISLAND_MAP[a], pb = ISLAND_MAP[b];
            if (!pa || !pb) return null;
            const vis = visibleIds.has(a) && visibleIds.has(b);
            return (
              <line key={`r${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#1d5a8a" strokeWidth="1" strokeDasharray="4 6"
                opacity={vis ? 0.12 : 0.03}/>
            );
          })}

          {/* Decorative fish */}
          <g opacity="0.06" fill="#4488bb">
            <path d="M680,500 C690,495 700,498 705,505 C700,510 690,512 680,508 C685,505 685,503 680,500Z"/>
            <path d="M150,180 C160,175 170,178 175,185 C170,190 160,192 150,188 C155,185 155,183 150,180Z"/>
            <path d="M1000,400 C1010,395 1020,398 1025,405 C1020,410 1010,412 1000,408 C1005,405 1005,403 1000,400Z"/>
          </g>

          {/* Decorative boats */}
          <g opacity="0.08" fill="none" stroke="#4488bb" strokeWidth="0.8">
            <g transform="translate(630,460)">
              <path d="M-6,0 Q0,4 6,0 Q0,-2 -6,0Z"/>
              <line x1="0" y1="0" x2="0" y2="-8"/>
              <path d="M0,-8 L5,-4 L0,-3Z" fill="#4488bb" opacity="0.5"/>
            </g>
            <g transform="translate(290,200)">
              <path d="M-5,0 Q0,3 5,0 Q0,-2 -5,0Z"/>
              <line x1="0" y1="0" x2="0" y2="-7"/>
              <path d="M0,-7 L4,-3 L0,-2Z" fill="#4488bb" opacity="0.5"/>
            </g>
          </g>

          {/* Compass rose */}
          <g transform={`translate(${W-60},${H-60})`} opacity="0.2">
            <circle cx="0" cy="0" r="22" fill="none" stroke="#4488bb" strokeWidth="0.5"/>
            <path d="M0,-20 L3,0 L0,6 L-3,0Z" fill="#4488bb"/>
            <path d="M0,20 L3,0 L0,-6 L-3,0Z" fill="#2a4060"/>
            <path d="M-20,0 L0,3 L6,0 L0,-3Z" fill="#2a4060"/>
            <path d="M20,0 L0,3 L-6,0 L0,-3Z" fill="#2a4060"/>
            <text x="0" y="-24" textAnchor="middle" fill="#4488bb" fontSize="7" fontWeight="700">N</text>
          </g>

          {/* Islands */}
          {Object.entries(ISLAND_MAP).map(([id, def]) => {
            const loc = locMap.get(id);
            const name = loc?.name || def.label || id.replace(/-/g, ' ');
            const vis = visibleIds.has(id);
            const isSel = selId === id;
            const biome = BIOME[def.biome] || BIOME.ocean;
            const sc = def.scale || 1;
            const fish = loc?.fish || [];
            const color = fish.length > 0 ? (RARITY_COLORS[bestRarity(fish)] || biome.accent) : biome.accent;
            const Deco = def.decoration ? DECO_MAP[def.decoration] : null;

            return (
              <g key={id} className="fwm-isle" opacity={vis ? 1 : 0.12}
                style={{ cursor: vis ? 'pointer' : 'default' }}
                onClick={() => vis && handleClick(id)}>

                {/* Selection pulse */}
                {isSel && (
                  <circle cx={def.x} cy={def.y} r={30 * sc} fill="none" stroke={color} strokeWidth="2" opacity="0.5">
                    <animate attributeName="r" from={20*sc} to={40*sc} dur="1.5s" repeatCount="indefinite"/>
                    <animate attributeName="opacity" from="0.5" to="0" dur="1.5s" repeatCount="indefinite"/>
                  </circle>
                )}

                {/* Ambient glow */}
                <circle cx={def.x} cy={def.y} r={18 * sc} fill={color}
                  opacity={isSel ? 0.2 : 0.08} filter="url(#gl)"/>

                {/* Island shape */}
                <path d={def.shape}
                  transform={`translate(${def.x},${def.y}) scale(${sc})`}
                  fill={biome.fill} stroke={isSel ? '#fff' : biome.stroke}
                  strokeWidth={isSel ? 2 : 0.8}
                  className="fwm-isle__shape"
                />

                {/* Decoration */}
                {Deco && <Deco x={def.x} y={def.y - 6 * sc} s={sc * 0.9}/>}

                {/* Label */}
                <text x={def.x} y={def.y + (def.shape === SHAPE_DOT ? 16 : 22) * sc}
                  textAnchor="middle" fill={isSel ? '#fff' : '#a0b8d0'}
                  fontSize={sc > 0.7 ? 9 : 7} fontFamily="Inter,system-ui,sans-serif"
                  fontWeight={isSel ? '700' : '500'} filter="url(#ts)"
                  className="fwm-isle__label">
                  {name.length > 22 ? name.slice(0, 20) + '…' : name}
                </text>

                {/* Fish count badge */}
                {loc && loc.fishCount > 0 && sc >= 0.5 && (
                  <g>
                    <circle cx={def.x + 14 * sc} cy={def.y - 14 * sc}
                      r={sc > 0.7 ? 7 : 5} fill="#0a1628" stroke={color} strokeWidth="0.7"/>
                    <text x={def.x + 14 * sc} y={def.y - 14 * sc + (sc > 0.7 ? 3 : 2)}
                      textAnchor="middle" fill="#E2E8F0"
                      fontSize={sc > 0.7 ? 6 : 5} fontFamily="monospace" fontWeight="700">
                      {loc.fishCount}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Credit */}
          <text x={W - 8} y={H - 8} textAnchor="end" fill="#1a3050" fontSize="7"
            fontFamily="Inter,system-ui,sans-serif" fontWeight="500">
            Map by codigos-gratis.com
          </text>
        </svg>
      </div>

      {/* Info Panel — below the map */}
      {selected && (
        <div className="fwm-panel" ref={panelRef}>
          <div className="fwm-panel__head">
            <div>
              <h3 className="fwm-panel__title">{selected.name}</h3>
              <div className="fwm-panel__meta">
                <span>{selected.fishCount} fish</span>
                {selected.isPremium && <span className="fwm-badge fwm-badge--p">Premium</span>}
                {selected.isEvent && <span className="fwm-badge fwm-badge--e">Event</span>}
                {selected.isSeasonal && <span className="fwm-badge fwm-badge--s">Seasonal</span>}
                {selected.coords && (
                  <span className="fwm-panel__coords">
                    X: {selected.coords.x} &bull; Z: {selected.coords.z}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setSelId(null)} className="fwm-panel__close">&times;</button>
          </div>

          <div className="fwm-panel__body">
            {selected.imagePath && (
              <img src={selected.imagePath} alt={selected.name} className="fwm-panel__img"/>
            )}

            <div className="fwm-panel__info">
              {selected.availableWeathers.length > 0 && (
                <div className="fwm-panel__weath">
                  <span className="fwm-panel__lbl">Weather:</span>
                  {selected.availableWeathers.map(w => <span key={w} className="fwm-wtag">{w}</span>)}
                </div>
              )}

              {selectedRarities.length > 1 && (
                <div className="fwm-panel__rchips">
                  <button onClick={() => setRarityFilter(null)}
                    className={`fwm-rch${!rarityFilter?' fwm-rch--on':''}`}>All</button>
                  {selectedRarities.map(r => (
                    <button key={r} onClick={() => setRarityFilter(rarityFilter===r?null:r)}
                      className={`fwm-rch${rarityFilter===r?' fwm-rch--on':''}`}
                      style={rarityFilter===r?{borderColor:RARITY_COLORS[r],color:RARITY_COLORS[r]}:{}}>
                      {r}
                    </button>
                  ))}
                </div>
              )}

              <div className="fwm-panel__fish">
                {selectedFish.length === 0 && <p className="fwm-panel__empty">No fish data available</p>}
                {selectedFish.map((f, i) => (
                  <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${f.id || slugify(f.name)}/`} className="fwm-f">
                    <span className="fwm-f__dot" style={{background: RARITY_COLORS[f.rarity]||'#888'}}/>
                    <span className="fwm-f__name">{f.name}</span>
                    <span className="fwm-f__rar" style={{color: RARITY_COLORS[f.rarity]||'#888'}}>{f.rarity}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <a href={`/games/${gameSlug}/locations/${selected.id}/`} className="fwm-panel__all">
            View all fish in {selected.name} &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
