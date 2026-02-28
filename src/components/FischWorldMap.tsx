import { useState, useMemo, useEffect, useRef } from 'react';

/* ================================================================
   FischWorldMap — Grouped island map with minimap + fish cards
   ================================================================ */

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
  'Trash':'#808080','Common':'#94a3b8','Uncommon':'#22c55e','Unusual':'#6366f1',
  'Rare':'#3b82f6','Legendary':'#f97316','Mythical':'#ef4444','Exotic':'#a855f7',
  'Secret':'#1ABC9C','Relic':'#CD7F32','Fragment':'#E056A0','Gemstone':'#00FFFF',
  'Extinct':'#5D6D7E','Limited':'#facc15','Apex':'#FF4500','Special':'#FF69B4',
  'Divine Secret':'#FFE066',
};
const RARITY_GRADIENTS: Record<string, string> = {
  'Trash':'linear-gradient(135deg,#2a2a2a,#404040)',
  'Common':'linear-gradient(135deg,#1e293b,#334155)',
  'Uncommon':'linear-gradient(135deg,#052e16,#166534)',
  'Unusual':'linear-gradient(135deg,#1e1b4b,#312e81)',
  'Rare':'linear-gradient(135deg,#0c1e3d,#1e3a5f)',
  'Legendary':'linear-gradient(135deg,#431407,#7c2d12)',
  'Mythical':'linear-gradient(135deg,#350a0a,#7f1d1d)',
  'Exotic':'linear-gradient(135deg,#2e1065,#581c87)',
  'Secret':'linear-gradient(135deg,#042f2e,#115e59)',
  'Relic':'linear-gradient(135deg,#3b1f06,#6b3a10)',
  'Fragment':'linear-gradient(135deg,#4a0e2e,#831843)',
  'Gemstone':'linear-gradient(135deg,#042f2e,#0e4441)',
  'Extinct':'linear-gradient(135deg,#1a1a2e,#2d3748)',
  'Limited':'linear-gradient(135deg,#3b2f04,#6b5310)',
  'Apex':'linear-gradient(135deg,#3b0a00,#7f1d00)',
  'Special':'linear-gradient(135deg,#3b0a2e,#831858)',
  'Divine Secret':'linear-gradient(135deg,#3b3004,#6b5a10)',
};
function slugify(n: string) { return n.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function bestRarity(fish: FishEntry[]): string {
  let b = 'Common', bo = 0;
  for (const f of fish) { const o = RARITY_ORDER[f.rarity]||0; if (o > bo) { bo = o; b = f.rarity; } }
  return b;
}
function glowClass(rarity: string): string {
  const o = RARITY_ORDER[rarity] || 0;
  if (o >= 8) return 'fwm-glow--exotic';
  if (o >= 7) return 'fwm-glow--mythical';
  if (o >= 6) return 'fwm-glow--legendary';
  if (o >= 5) return 'fwm-glow--rare';
  return '';
}

// Weather
const WEATHER_CLASS: Record<string, string> = {
  'Sunny':'fwm-wc--sunny','Rain':'fwm-wc--rain','Thunder':'fwm-wc--thunder',
  'Wind':'fwm-wc--wind','Foggy':'fwm-wc--foggy','Blizzard':'fwm-wc--blizzard',
  'Snow':'fwm-wc--snow','Any':'fwm-wc--any',
};
const WEATHER_ICON: Record<string, string> = {
  'Sunny':'☀️','Rain':'🌧️','Thunder':'⛈️','Wind':'💨','Foggy':'🌫️',
  'Blizzard':'🌨️','Snow':'❄️','Any':'🌤️',
};

// ---- Procedural island shape ----
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function generateIslandPath(name: string, cx: number, cy: number, rx: number, ry: number): string {
  const seed = hashStr(name);
  const rng = seededRandom(seed);
  const n = 12 + Math.floor(rng() * 6); // 12-17 points
  const points: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const noise = 0.7 + rng() * 0.6; // 0.7-1.3
    const px = cx + Math.cos(angle) * rx * noise;
    const py = cy + Math.sin(angle) * ry * noise;
    points.push([px, py]);
  }
  // Smooth catmull-rom → cubic bezier
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  d += 'Z';
  return d;
}

// Place sub-location dots on the island minimap
function subLocPositions(count: number, name: string): { x: number; y: number }[] {
  if (count <= 1) return [{ x: 150, y: 120 }];
  const rng = seededRandom(hashStr(name + 'pos'));
  const positions: { x: number; y: number }[] = [];
  const cx = 150, cy = 120, spread = 55;
  // Place in a rough circle/scatter
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng() * 0.5;
    const dist = spread * 0.3 + rng() * spread * 0.5;
    positions.push({
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist * 0.75,
    });
  }
  return positions;
}

const BIOME_COLORS: Record<string, { fill: string; stroke: string; glow: string }> = {
  tropical: { fill: '#065f46', stroke: '#059669', glow: '#10b981' },
  volcanic: { fill: '#7f1d1d', stroke: '#dc2626', glow: '#f87171' },
  snow:     { fill: '#64748b', stroke: '#94a3b8', glow: '#e2e8f0' },
  swamp:    { fill: '#365314', stroke: '#4d7c0f', glow: '#84cc16' },
  dark:     { fill: '#1e1b4b', stroke: '#4338ca', glow: '#818cf8' },
  sand:     { fill: '#92400e', stroke: '#d97706', glow: '#fbbf24' },
  ocean:    { fill: '#0c4a6e', stroke: '#0284c7', glow: '#38bdf8' },
  mystic:   { fill: '#581c87', stroke: '#9333ea', glow: '#c084fc' },
};

// ---- Island groups ----
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; left: string; top: string;
  sea: 'first' | 'second' | 'deep'; size?: 'small' | 'large';
}

const ISLAND_GROUPS: IslandGroup[] = [
  { id: 'sunstone-island', name: 'Sunstone Island',   icon: '☀️', biome: 'sand',     children: ['sunstone-island','desolate-deep'], left: '12%', top: '14%', sea: 'first' },
  { id: 'northern-caves',  name: 'Northern Caves',    icon: '🦇', biome: 'dark',     children: ['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], left: '32%', top: '8%', sea: 'deep', size: 'small' },
  { id: 'castaway-cliffs', name: 'Castaway Cliffs',   icon: '🪨', biome: 'tropical', children: ['castaway-cliffs'], left: '50%', top: '6%', sea: 'first', size: 'small' },
  { id: 'emberreach',      name: 'Emberreach',        icon: '🔥', biome: 'volcanic', children: ['emberreach'], left: '64%', top: '10%', sea: 'first', size: 'small' },
  { id: 'ancient-isle',    name: 'Ancient Isle',      icon: '🏛️', biome: 'sand',     children: ['ancient-isle'], left: '82%', top: '12%', sea: 'first' },
  { id: 'keepers-altar',   name: "Keeper's Altar",    icon: '⛩️', biome: 'mystic',   children: ['keepers-altar'], left: '24%', top: '26%', sea: 'first', size: 'small' },
  { id: 'the-ocean',       name: 'The Ocean',         icon: '🌊', biome: 'ocean',    children: ['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], left: '38%', top: '28%', sea: 'first' },
  { id: 'roslit-bay',      name: 'Roslit Bay',        icon: '🌋', biome: 'volcanic', children: ['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], left: '6%', top: '40%', sea: 'first', size: 'large' },
  { id: 'moosewood',       name: 'Moosewood',         icon: '🏠', biome: 'tropical', children: ['moosewood','executive-lake','isle-of-new-beginnings'], left: '44%', top: '40%', sea: 'first', size: 'large' },
  { id: 'lushgrove',       name: 'Lushgrove',         icon: '🌿', biome: 'tropical', children: ['lushgrove'], left: '58%', top: '30%', sea: 'first' },
  { id: 'mushgrove-swamp', name: 'Mushgrove Swamp',   icon: '🍄', biome: 'swamp',    children: ['mushgrove-swamp'], left: '72%', top: '32%', sea: 'first' },
  { id: 'cursed-isle',     name: 'Cursed Isle',       icon: '💀', biome: 'dark',     children: ['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], left: '86%', top: '38%', sea: 'first', size: 'small' },
  { id: 'forsaken-shores', name: 'Forsaken Shores',   icon: '🏝️', biome: 'sand',     children: ['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], left: '8%', top: '64%', sea: 'first' },
  { id: 'deep-trenches',   name: 'Deep Trenches',     icon: '🕳️', biome: 'dark',     children: ['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], left: '22%', top: '58%', sea: 'deep', size: 'small' },
  { id: 'vertigo',         name: 'Vertigo',           icon: '🌀', biome: 'dark',     children: ['vertigo','the-depths'], left: '34%', top: '60%', sea: 'first', size: 'small' },
  { id: 'terrapin-island', name: 'Terrapin Island',   icon: '🐢', biome: 'tropical', children: ['terrapin-island','pine-shoals','carrot-garden'], left: '50%', top: '62%', sea: 'first' },
  { id: 'azure-lagoon',    name: 'Azure Lagoon',      icon: '💎', biome: 'ocean',    children: ['azure-lagoon'], left: '64%', top: '56%', sea: 'first', size: 'small' },
  { id: 'snowcap-island',  name: 'Snowcap Island',    icon: '❄️', biome: 'snow',     children: ['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], left: '78%', top: '60%', sea: 'first', size: 'large' },
  { id: 'waveborne',       name: 'Waveborne',         icon: '⛵', biome: 'mystic',   children: ['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], left: '38%', top: '82%', sea: 'second' },
  { id: 'treasure-island', name: 'Treasure Island',   icon: '💰', biome: 'sand',     children: ['treasure-island'], left: '62%', top: '82%', sea: 'second', size: 'small' },
];

const EVENT_IDS = ['admin-events','fischfright-2025','winter-village','lego-event-2025','fischgiving-2025'];
const EVENT_ICONS: Record<string, string> = {
  'admin-events':'⭐','fischfright-2025':'🎃','winter-village':'🎄','lego-event-2025':'🧱','fischgiving-2025':'🦃',
};

// ---- Component ----
export default function FischWorldMap({ locations, gameSlug }: Props) {
  const locMap = useMemo(() => {
    const m = new Map<string, MapLocation>();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

  const [filter, setFilter] = useState<'all'|'first'|'second'|'deep'>('all');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [selEventId, setSelEventId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const groupData = useMemo(() => {
    return ISLAND_GROUPS.map(g => {
      const childLocs = g.children.map(id => locMap.get(id)).filter(Boolean) as MapLocation[];
      const allFish = childLocs.flatMap(l => l.fish);
      const totalFish = childLocs.reduce((s, l) => s + l.fishCount, 0);
      const primaryLoc = locMap.get(g.children[0]) || childLocs[0];
      const imagePath = primaryLoc?.imagePath || childLocs.find(l => l.imagePath)?.imagePath || null;
      const isPremium = childLocs.some(l => l.isPremium);
      const isSeasonal = childLocs.some(l => l.isSeasonal);
      const weathers = Array.from(new Set(childLocs.flatMap(l => l.availableWeathers)));
      const coords = primaryLoc?.coords || null;
      const topRarity = allFish.length > 0 ? bestRarity(allFish) : 'Common';
      return { ...g, childLocs, allFish, totalFish, imagePath, isPremium, isSeasonal, weathers, coords, topRarity };
    });
  }, [locMap]);

  const eventLocs = useMemo(() =>
    EVENT_IDS.map(id => locMap.get(id)).filter(Boolean) as MapLocation[]
  , [locMap]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groupData.find(g => g.id === loc);
    if (direct) { setSelId(direct.id); return; }
    const parent = groupData.find(g => g.children.includes(loc));
    if (parent) { setSelId(parent.id); setActiveTab(loc); }
  }, [groupData]);

  useEffect(() => {
    if ((selId || selEventId) && panelRef.current) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }, [selId, selEventId]);

  const visibleGroups = useMemo(() => {
    return groupData.filter(g => {
      if (filter === 'first' && g.sea !== 'first') return false;
      if (filter === 'second' && g.sea !== 'second') return false;
      if (filter === 'deep' && g.sea !== 'deep') return false;
      if (search) {
        const q = search.toLowerCase();
        if (!g.name.toLowerCase().includes(q) &&
            !g.childLocs.some(l => l.name.toLowerCase().includes(q)) &&
            !g.allFish.some(f => f.name.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [groupData, filter, search]);
  const visibleIds = useMemo(() => new Set(visibleGroups.map(g => g.id)), [visibleGroups]);

  const selected = useMemo(() => groupData.find(g => g.id === selId) || null, [groupData, selId]);
  const selectedEvent = useMemo(() => selEventId ? locMap.get(selEventId) || null : null, [selEventId, locMap]);

  const selectedFish = useMemo(() => {
    if (!selected) return [];
    let fish: FishEntry[];
    if (activeTab) {
      const tabLoc = locMap.get(activeTab);
      fish = tabLoc ? [...tabLoc.fish] : [];
    } else {
      fish = [...selected.allFish];
    }
    fish.sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selected, activeTab, rarityFilter, locMap]);

  const selectedRarities = useMemo(() => {
    if (!selected) return [];
    const src = activeTab ? (locMap.get(activeTab)?.fish || []) : selected.allFish;
    return Array.from(new Set(src.map(f => f.rarity)))
      .sort((a, b) => (RARITY_ORDER[b]||0) - (RARITY_ORDER[a]||0));
  }, [selected, activeTab, locMap]);

  const eventFish = useMemo(() => {
    if (!selectedEvent) return [];
    let fish = [...selectedEvent.fish].sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selectedEvent, rarityFilter]);
  const eventRarities = useMemo(() => {
    if (!selectedEvent) return [];
    return Array.from(new Set(selectedEvent.fish.map(f => f.rarity)))
      .sort((a, b) => (RARITY_ORDER[b]||0) - (RARITY_ORDER[a]||0));
  }, [selectedEvent]);

  const handleGroupClick = (id: string) => {
    setSelEventId(null); setRarityFilter(null); setActiveTab(null);
    setSelId(prev => prev === id ? null : id);
  };
  const handleEventClick = (id: string) => {
    setSelId(null); setActiveTab(null); setRarityFilter(null);
    setSelEventId(prev => prev === id ? null : id);
  };
  const closePanel = () => { setSelId(null); setSelEventId(null); setActiveTab(null); setRarityFilter(null); };

  // ---- Fish card grid ----
  function FishGrid({ fishList, gs }: { fishList: FishEntry[]; gs: string }) {
    if (fishList.length === 0) return <p className="fwm-card__empty">No fish data available</p>;
    return (
      <div className="fwm-fgrid">
        {fishList.map((f, i) => {
          const id = f.id || slugify(f.name);
          const color = RARITY_COLORS[f.rarity] || '#94a3b8';
          const grad = RARITY_GRADIENTS[f.rarity] || RARITY_GRADIENTS['Common'];
          return (
            <a key={`${f.name}-${i}`} href={`/games/${gs}/fish/${id}/`} className="fwm-fc">
              <div className="fwm-fc__imgwrap" style={{ background: grad }}>
                <img src={`/images/fish/${id}.png`} alt={f.name} className="fwm-fc__img" loading="lazy"/>
              </div>
              <div className="fwm-fc__body">
                <span className="fwm-fc__name">{f.name}</span>
                <span className="fwm-fc__rar" style={{ color, borderColor: color }}>{f.rarity}</span>
              </div>
            </a>
          );
        })}
      </div>
    );
  }

  // ---- Island minimap SVG ----
  function IslandMinimap({ group }: { group: typeof groupData[0] }) {
    const biome = BIOME_COLORS[group.biome] || BIOME_COLORS.ocean;
    const path = generateIslandPath(group.name, 150, 120, 100, 75);
    const positions = subLocPositions(group.childLocs.length, group.name);

    return (
      <div className="fwm-minimap">
        <svg viewBox="0 0 300 240" className="fwm-minimap__svg">
          <defs>
            <radialGradient id={`mg-${group.id}`} cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor={biome.fill} stopOpacity="0.9"/>
              <stop offset="100%" stopColor={biome.fill} stopOpacity="0.3"/>
            </radialGradient>
            <filter id={`mgl-${group.id}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Water bg */}
          <rect width="300" height="240" fill="#0a1628" rx="12"/>

          {/* Subtle water ripples */}
          <circle cx="50" cy="200" r="30" fill="none" stroke={biome.stroke} strokeWidth="0.5" opacity="0.08"/>
          <circle cx="250" cy="50" r="25" fill="none" stroke={biome.stroke} strokeWidth="0.5" opacity="0.06"/>

          {/* Island glow */}
          <path d={path} fill={biome.glow} opacity="0.15" filter={`url(#mgl-${group.id})`}/>

          {/* Island shape */}
          <path d={path} fill={`url(#mg-${group.id})`} stroke={biome.stroke} strokeWidth="1.5"/>

          {/* Inner detail lines */}
          <path d={path} fill="none" stroke={biome.stroke} strokeWidth="0.5" opacity="0.3"
            strokeDasharray="4 6" transform="translate(2,2) scale(0.97)"/>

          {/* Sub-location points */}
          {group.childLocs.map((loc, i) => {
            const pos = positions[i] || { x: 150, y: 120 };
            const isActive = activeTab === loc.id;
            const dotColor = isActive ? '#22d3ee' : biome.glow;
            return (
              <g key={loc.id} className="fwm-minimap__dot"
                onClick={(e) => { e.stopPropagation(); setActiveTab(isActive ? null : loc.id); setRarityFilter(null); }}
                style={{ cursor: 'pointer' }}>
                {/* Glow */}
                <circle cx={pos.x} cy={pos.y} r={isActive ? 12 : 8} fill={dotColor} opacity={isActive ? 0.3 : 0.15}/>
                {/* Dot */}
                <circle cx={pos.x} cy={pos.y} r={isActive ? 6 : 4}
                  fill={isActive ? '#22d3ee' : '#fff'} stroke={dotColor} strokeWidth="1.5"/>
                {/* Label */}
                <text x={pos.x} y={pos.y + (isActive ? 18 : 14)} textAnchor="middle"
                  fill={isActive ? '#22d3ee' : '#cbd5e1'} fontSize={isActive ? '9' : '8'}
                  fontFamily="Inter,system-ui,sans-serif" fontWeight={isActive ? '700' : '500'}>
                  {loc.name.length > 18 ? loc.name.slice(0, 16) + '…' : loc.name}
                </text>
                {/* Fish count */}
                <text x={pos.x} y={pos.y + (isActive ? 28 : 24)} textAnchor="middle"
                  fill="#64748b" fontSize="7" fontFamily="Inter,system-ui,sans-serif">
                  {loc.fishCount} fish
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // ---- Shared panel content ----
  function PanelContent({ title, fishCount, imagePath, imageIcon, biome, coords, weathers, rarities, fishList, badges, viewAllHref, minimap }: {
    title: string; fishCount: number; imagePath: string | null; imageIcon: string; biome: string;
    coords: { x: number; z: number } | null; weathers: string[]; rarities: string[];
    fishList: FishEntry[]; badges: JSX.Element; viewAllHref: string; minimap: JSX.Element | null;
  }) {
    return (
      <div className="fwm-detail" ref={panelRef}>
        <div className="fwm-card">
          {/* Header */}
          <div className="fwm-card__head">
            {imagePath && <img src={imagePath} alt={title} className="fwm-card__thumb"/>}
            <div className="fwm-card__info">
              <h2 className="fwm-card__title">{title}</h2>
              <div className="fwm-card__meta">
                <span className="fwm-card__fc">🐟 {fishCount} fish</span>
                {badges}
                {coords && <span className="fwm-card__coords">X: {coords.x} &bull; Z: {coords.z}</span>}
              </div>
            </div>
            <button className="fwm-card__close" onClick={closePanel}>✕</button>
          </div>

          {/* Minimap + filters side by side on desktop */}
          <div className="fwm-card__content">
            {minimap && (
              <div className="fwm-card__left">
                {minimap}
              </div>
            )}
            <div className="fwm-card__right">
              {/* Weather */}
              {weathers.length > 0 && (
                <div className="fwm-card__weath">
                  <span className="fwm-card__wlbl">Weather:</span>
                  {weathers.map(w => (
                    <span key={w} className={`fwm-wc ${WEATHER_CLASS[w]||'fwm-wc--any'}`}>
                      {WEATHER_ICON[w]||'🌤️'} {w}
                    </span>
                  ))}
                </div>
              )}

              {/* Rarity filters */}
              {rarities.length > 1 && (
                <div className="fwm-card__rpills">
                  <button onClick={() => setRarityFilter(null)}
                    className={`fwm-rpill${!rarityFilter?' fwm-rpill--on':''}`}>All</button>
                  {rarities.map(r => (
                    <button key={r} onClick={() => setRarityFilter(rarityFilter===r?null:r)}
                      className={`fwm-rpill${rarityFilter===r?' fwm-rpill--on':''}`}
                      style={rarityFilter===r?{borderColor:RARITY_COLORS[r],color:RARITY_COLORS[r]}:{}}>
                      {r}
                    </button>
                  ))}
                </div>
              )}

              {/* Fish card grid */}
              <FishGrid fishList={fishList} gs={gameSlug}/>
            </div>
          </div>

          <a href={viewAllHref} className="fwm-card__viewall">View all fish in {title} →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="fwm">
      {/* Controls */}
      <div className="fwm-controls">
        <input type="text" className="fwm-search" placeholder="Search island or fish..."
          value={search} onChange={e => setSearch(e.target.value)}/>
        <div className="fwm-pills">
          {(['all','first','second','deep'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`fwm-pill${filter===f?' fwm-pill--on':''}`}>
              {f==='all'?'All':f==='first'?'First Sea':f==='second'?'Second Sea':'Deep'}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="fwm-ocean">
        <div className="fwm-grid"/>
        <div className="fwm-wave1"/>
        <div className="fwm-wave2"/>
        <span className="fwm-region fwm-region--first">— First Sea —</span>
        <span className="fwm-region fwm-region--second">— Second Sea —</span>
        <div className="fwm-compass"/>

        {groupData.map(g => {
          const vis = visibleIds.has(g.id);
          const isSel = selId === g.id;
          const glow = glowClass(g.topRarity);
          const sizeClass = g.size ? ` fwm-isle--${g.size}` : '';
          return (
            <div key={g.id}
              className={`fwm-isle${sizeClass}${glow ? ` ${glow}` : ''}${isSel ? ' fwm-isle--sel' : ''}`}
              style={{ left: g.left, top: g.top, opacity: vis ? 1 : 0.15 }}
              onClick={() => vis && handleGroupClick(g.id)}>
              <div className="fwm-isle__circle">
                {g.imagePath ? (
                  <img src={g.imagePath} alt={g.name} className="fwm-isle__img"/>
                ) : (
                  <div className={`fwm-isle__ph fwm-biome--${g.biome}`}>{g.icon}</div>
                )}
              </div>
              <span className="fwm-isle__name">{g.name}</span>
              {g.totalFish > 0 && <span className="fwm-isle__badge">{g.totalFish} fish</span>}
            </div>
          );
        })}
      </div>

      {/* Detail Panel — group */}
      {selected && (
        <PanelContent
          title={selected.name} fishCount={selected.totalFish}
          imagePath={selected.imagePath} imageIcon={selected.icon}
          biome={selected.biome} coords={selected.coords}
          weathers={selected.weathers} rarities={selectedRarities}
          fishList={selectedFish}
          badges={<>
            {selected.isPremium && <span className="fwm-badge fwm-badge--p">Premium</span>}
            {selected.isSeasonal && <span className="fwm-badge fwm-badge--s">Seasonal</span>}
          </>}
          viewAllHref={`/games/${gameSlug}/locations/${selected.children[0]}/`}
          minimap={selected.childLocs.length > 1 ? <IslandMinimap group={selected}/> : null}
        />
      )}

      {/* Detail Panel — event */}
      {selectedEvent && (
        <PanelContent
          title={selectedEvent.name} fishCount={selectedEvent.fishCount}
          imagePath={selectedEvent.imagePath} imageIcon={EVENT_ICONS[selEventId!] || '🎉'}
          biome="dark" coords={selectedEvent.coords}
          weathers={selectedEvent.availableWeathers} rarities={eventRarities}
          fishList={eventFish}
          badges={<><span className="fwm-badge fwm-badge--e">Event</span><span className="fwm-badge fwm-badge--lim">Limited</span></>}
          viewAllHref={`/games/${gameSlug}/locations/${selEventId}/`}
          minimap={null}
        />
      )}

      {/* Event cards */}
      {eventLocs.length > 0 && (
        <div className="fwm-events">
          <div className="fwm-events__title">⚡ Event Locations</div>
          <div className="fwm-events__row">
            {eventLocs.map(loc => (
              <button key={loc.id} onClick={() => handleEventClick(loc.id)}
                className={`fwm-evt${selEventId===loc.id?' fwm-evt--on':''}`}>
                <span className="fwm-evt__icon">{EVENT_ICONS[loc.id] || '🎉'}</span>
                <span className="fwm-evt__name">{loc.name}</span>
                <span className="fwm-evt__badge">ENDED</span>
                {loc.fishCount > 0 && <span className="fwm-evt__fish">{loc.fishCount} fish</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
