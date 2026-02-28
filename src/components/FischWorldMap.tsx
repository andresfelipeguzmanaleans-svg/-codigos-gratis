import { useState, useMemo, useEffect, useCallback } from 'react';

/* ================================================================
   FischWorldMap — 3-level drill-down interactive map
   Level 1: World map with ~20 island circles
   Level 2: Island detail (minimap left + info panel right)
   Level 3: Fish orbiting around selected sub-location
   Everything renders INSIDE the same map viewport.
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
  'Secret':'#06b6d4','Relic':'#CD7F32','Fragment':'#E056A0','Gemstone':'#00FFFF',
  'Extinct':'#9ca3af','Limited':'#facc15','Apex':'#FF4500','Special':'#FF69B4',
  'Divine Secret':'#FFE066',
};

function slugify(n: string) { return n.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function bestRarity(fish: FishEntry[]): string {
  let b = 'Common', bo = 0;
  for (const f of fish) { const o = RARITY_ORDER[f.rarity]||0; if (o > bo) { bo = o; b = f.rarity; } }
  return b;
}
function islandSizeCls(count: number): string {
  if (count >= 50) return 'fwm-isle--xl';
  if (count >= 30) return 'fwm-isle--lg';
  if (count >= 15) return 'fwm-isle--md';
  return 'fwm-isle--sm';
}

// Weather
const WX_CLS: Record<string, string> = {
  'Sunny':'fwm-wx--sun','Rain':'fwm-wx--rain','Thunder':'fwm-wx--thun',
  'Wind':'fwm-wx--wind','Foggy':'fwm-wx--fog','Blizzard':'fwm-wx--bliz',
  'Snow':'fwm-wx--snow','Any':'fwm-wx--any',
};
const WX_ICO: Record<string, string> = {
  'Sunny':'☀️','Rain':'🌧️','Thunder':'⛈️','Wind':'💨','Foggy':'🌫️',
  'Blizzard':'🌨️','Snow':'❄️','Any':'🌤️',
};

// ---- Procedural shapes ----
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
}
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function generateIslandPath(name: string, cx: number, cy: number, rx: number, ry: number): string {
  const rng = seededRandom(hashStr(name));
  const n = 12 + Math.floor(rng() * 6);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const noise = 0.7 + rng() * 0.6;
    pts.push([cx + Math.cos(a) * rx * noise, cy + Math.sin(a) * ry * noise]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

// Sub-location dots positions (% within minimap)
function getSubDotPos(count: number, name: string): { left: string; top: string }[] {
  if (count === 0) return [];
  if (count === 1) return [{ left: '50%', top: '48%' }];
  const rng = seededRandom(hashStr(name + 'sub'));
  const spread = count <= 3 ? 14 : count <= 6 ? 17 : count <= 10 ? 20 : 23;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + rng() * 0.5;
    const dist = spread * 0.4 + rng() * spread * 0.6;
    return {
      left: `${(50 + Math.cos(a) * dist).toFixed(1)}%`,
      top: `${(48 + Math.sin(a) * dist * 0.7).toFixed(1)}%`,
    };
  });
}

// Orbit positions for fish cards around center (px offsets)
function getOrbitPos(count: number): { x: number; y: number }[] {
  if (count === 0) return [];
  if (count <= 12) {
    const r = count <= 4 ? 80 : count <= 7 ? 95 : count <= 10 ? 110 : 125;
    return Array.from({ length: count }, (_, i) => ({
      x: Math.cos((i / count) * Math.PI * 2 - Math.PI / 2) * r,
      y: Math.sin((i / count) * Math.PI * 2 - Math.PI / 2) * r * 0.75,
    }));
  }
  const inner = Math.ceil(count / 2), outer = count - inner;
  const pos: { x: number; y: number }[] = [];
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * Math.PI * 2 - Math.PI / 2;
    pos.push({ x: Math.cos(a) * 85, y: Math.sin(a) * 85 * 0.75 });
  }
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 - Math.PI / 2 + Math.PI / outer;
    pos.push({ x: Math.cos(a) * 150, y: Math.sin(a) * 150 * 0.75 });
  }
  return pos;
}

// Rarity inline styles
function rarBorderSt(r: string): React.CSSProperties {
  const c = RARITY_COLORS[r] || '#94a3b8'; return { borderColor: `${c}80` };
}
function rarBgSt(r: string): React.CSSProperties {
  const c = RARITY_COLORS[r] || '#94a3b8'; return { background: `linear-gradient(135deg, ${c}30, ${c}0d)` };
}
function rarBadgeSt(r: string): React.CSSProperties {
  const c = RARITY_COLORS[r] || '#94a3b8'; return { background: `${c}25`, color: c };
}

// ---- Biome colors ----
const BIOME: Record<string, { fill: string; stroke: string }> = {
  tropical: { fill: '#065f46', stroke: '#059669' },
  volcanic: { fill: '#7f1d1d', stroke: '#dc2626' },
  snow:     { fill: '#64748b', stroke: '#94a3b8' },
  swamp:    { fill: '#365314', stroke: '#4d7c0f' },
  dark:     { fill: '#1e1b4b', stroke: '#4338ca' },
  sand:     { fill: '#92400e', stroke: '#d97706' },
  ocean:    { fill: '#0c4a6e', stroke: '#0284c7' },
  mystic:   { fill: '#581c87', stroke: '#9333ea' },
};

// ---- Island groups ----
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; left: string; top: string;
  sea: 'first' | 'second' | 'deep';
}

const ISLAND_GROUPS: IslandGroup[] = [
  { id: 'sunstone-island', name: 'Sunstone Island', icon: '☀️', biome: 'sand', children: ['sunstone-island','desolate-deep'], left: '12%', top: '14%', sea: 'first' },
  { id: 'northern-caves', name: 'Northern Caves', icon: '🦇', biome: 'dark', children: ['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], left: '32%', top: '8%', sea: 'deep' },
  { id: 'castaway-cliffs', name: 'Castaway Cliffs', icon: '🪨', biome: 'tropical', children: ['castaway-cliffs'], left: '50%', top: '6%', sea: 'first' },
  { id: 'emberreach', name: 'Emberreach', icon: '🔥', biome: 'volcanic', children: ['emberreach'], left: '64%', top: '10%', sea: 'first' },
  { id: 'ancient-isle', name: 'Ancient Isle', icon: '🏛️', biome: 'sand', children: ['ancient-isle'], left: '82%', top: '12%', sea: 'first' },
  { id: 'keepers-altar', name: "Keeper's Altar", icon: '⛩️', biome: 'mystic', children: ['keepers-altar'], left: '24%', top: '26%', sea: 'first' },
  { id: 'the-ocean', name: 'The Ocean', icon: '🌊', biome: 'ocean', children: ['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], left: '38%', top: '28%', sea: 'first' },
  { id: 'roslit-bay', name: 'Roslit Bay', icon: '🌋', biome: 'volcanic', children: ['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], left: '6%', top: '40%', sea: 'first' },
  { id: 'moosewood', name: 'Moosewood', icon: '🏠', biome: 'tropical', children: ['moosewood','executive-lake','isle-of-new-beginnings'], left: '44%', top: '40%', sea: 'first' },
  { id: 'lushgrove', name: 'Lushgrove', icon: '🌿', biome: 'tropical', children: ['lushgrove'], left: '58%', top: '30%', sea: 'first' },
  { id: 'mushgrove-swamp', name: 'Mushgrove Swamp', icon: '🍄', biome: 'swamp', children: ['mushgrove-swamp'], left: '72%', top: '32%', sea: 'first' },
  { id: 'cursed-isle', name: 'Cursed Isle', icon: '💀', biome: 'dark', children: ['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], left: '86%', top: '38%', sea: 'first' },
  { id: 'forsaken-shores', name: 'Forsaken Shores', icon: '🏝️', biome: 'sand', children: ['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], left: '8%', top: '64%', sea: 'first' },
  { id: 'deep-trenches', name: 'Deep Trenches', icon: '🕳️', biome: 'dark', children: ['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], left: '22%', top: '58%', sea: 'deep' },
  { id: 'vertigo', name: 'Vertigo', icon: '🌀', biome: 'dark', children: ['vertigo','the-depths'], left: '34%', top: '60%', sea: 'first' },
  { id: 'terrapin-island', name: 'Terrapin Island', icon: '🐢', biome: 'tropical', children: ['terrapin-island','pine-shoals','carrot-garden'], left: '50%', top: '62%', sea: 'first' },
  { id: 'azure-lagoon', name: 'Azure Lagoon', icon: '💎', biome: 'ocean', children: ['azure-lagoon'], left: '64%', top: '56%', sea: 'first' },
  { id: 'snowcap-island', name: 'Snowcap Island', icon: '❄️', biome: 'snow', children: ['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], left: '78%', top: '60%', sea: 'first' },
  { id: 'waveborne', name: 'Waveborne', icon: '⛵', biome: 'mystic', children: ['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], left: '38%', top: '82%', sea: 'second' },
  { id: 'treasure-island', name: 'Treasure Island', icon: '💰', biome: 'sand', children: ['treasure-island'], left: '62%', top: '82%', sea: 'second' },
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

  // ---- State ----
  const [level, setLevel] = useState<1|2|3>(1);
  const [selGroupId, setSelGroupId] = useState<string | null>(null);
  const [selSubId, setSelSubId] = useState<string | null>(null);
  const [showAllOrbit, setShowAllOrbit] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Selected group (or virtual group for events)
  const selGroup = useMemo(() => {
    if (!selGroupId) return null;
    const g = groupData.find(g => g.id === selGroupId);
    if (g) return g;
    const loc = locMap.get(selGroupId);
    if (!loc) return null;
    return {
      id: loc.id, name: loc.name, icon: EVENT_ICONS[loc.id] || '📍',
      biome: 'dark', children: [loc.id], left: '0%', top: '0%',
      sea: 'first' as const,
      childLocs: [loc], allFish: [...loc.fish], totalFish: loc.fishCount,
      imagePath: loc.imagePath, isPremium: loc.isPremium, isSeasonal: loc.isSeasonal,
      weathers: loc.availableWeathers, coords: loc.coords,
      topRarity: bestRarity(loc.fish),
    };
  }, [selGroupId, groupData, locMap]);

  const selSub = useMemo(() => selSubId ? locMap.get(selSubId) || null : null, [selSubId, locMap]);

  // Panel fish
  const panelFish = useMemo(() => {
    if (!selGroup) return [];
    const fish = selSubId
      ? [...(locMap.get(selSubId)?.fish || [])]
      : [...selGroup.allFish];
    return fish.sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
  }, [selGroup, selSubId, locMap]);

  // Orbit fish
  const orbitFish = useMemo(() => {
    if (!selSub) return [];
    const sorted = [...selSub.fish].sort((a, b) => (RARITY_ORDER[b.rarity]||0) - (RARITY_ORDER[a.rarity]||0));
    return showAllOrbit ? sorted : sorted.slice(0, 10);
  }, [selSub, showAllOrbit]);
  const extraOrbitCount = useMemo(() => {
    if (!selSub || selSub.fish.length <= 10) return 0;
    return selSub.fish.length - 10;
  }, [selSub]);

  // ---- Navigation ----
  const enterIsland = useCallback((gid: string) => {
    setSelGroupId(gid);
    setSelSubId(null);
    setShowAllOrbit(false);
    setLevel(2);
  }, []);

  const exitIsland = useCallback(() => {
    setLevel(1);
    setTimeout(() => { setSelGroupId(null); setSelSubId(null); setShowAllOrbit(false); }, 450);
  }, []);

  const selectSubzone = useCallback((locId: string) => {
    if (selSubId === locId) {
      setSelSubId(null);
      setLevel(2);
    } else {
      setSelSubId(locId);
      setShowAllOrbit(false);
      setLevel(3);
    }
  }, [selSubId]);

  const goBack = useCallback(() => {
    if (level === 3) { setSelSubId(null); setLevel(2); }
    else if (level === 2) exitIsland();
  }, [level, exitIsland]);

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && level > 1) goBack(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [goBack, level]);

  // URL params
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groupData.find(g => g.id === loc);
    if (direct) { enterIsland(direct.id); return; }
    const parent = groupData.find(g => g.children.includes(loc));
    if (parent) { setSelGroupId(parent.id); setSelSubId(loc); setLevel(3); }
  }, [groupData]);

  // Filtered groups
  const visibleGroups = useMemo(() => {
    return groupData.filter(g => {
      if (filter === 'first' && g.sea !== 'first') return false;
      if (filter === 'second' && g.sea !== 'second') return false;
      if (filter === 'deep' && g.sea !== 'deep') return false;
      if (search) {
        const q = search.toLowerCase();
        return g.name.toLowerCase().includes(q) ||
          g.childLocs.some(l => l.name.toLowerCase().includes(q)) ||
          g.allFish.some(f => f.name.toLowerCase().includes(q));
      }
      return true;
    });
  }, [groupData, filter, search]);
  const visibleIds = useMemo(() => new Set(visibleGroups.map(g => g.id)), [visibleGroups]);

  // Sub-dot positions
  const subDots = useMemo(() => {
    if (!selGroup) return [];
    return getSubDotPos(selGroup.childLocs.length, selGroup.name);
  }, [selGroup]);

  // Active sub-dot position (for orbit anchor)
  const activeSubPos = useMemo(() => {
    if (!selGroup || !selSubId) return null;
    const idx = selGroup.childLocs.findIndex(l => l.id === selSubId);
    return idx >= 0 ? subDots[idx] : null;
  }, [selGroup, selSubId, subDots]);

  const orbitPos = useMemo(() => getOrbitPos(orbitFish.length), [orbitFish.length]);

  const biome = selGroup ? BIOME[selGroup.biome] || BIOME.ocean : BIOME.ocean;

  // ---- Render ----
  return (
    <div className="fwm">
      {/* Controls */}
      <div className="fwm-controls">
        <input type="text" className="fwm-search" placeholder="Search island or fish..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="fwm-pills">
          {(['all','first','second','deep'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`fwm-pill${filter===f?' fwm-pill--on':''}`}>
              {f==='all'?'All':f==='first'?'First Sea':f==='second'?'Second Sea':'Deep'}
            </button>
          ))}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="fwm-bread">
        {level === 1 ? (
          <span className="fwm-bread__cur">🗺️ World Map</span>
        ) : (
          <>
            <a className="fwm-bread__link" onClick={exitIsland}>🗺️ World Map</a>
            <span className="fwm-bread__sep">›</span>
            {level === 2 ? (
              <span className="fwm-bread__cur">{selGroup?.icon} {selGroup?.name}</span>
            ) : (
              <>
                <a className="fwm-bread__link" onClick={() => { setSelSubId(null); setLevel(2); }}>
                  {selGroup?.icon} {selGroup?.name}
                </a>
                <span className="fwm-bread__sep">›</span>
                <span className="fwm-bread__cur">{selSub?.name}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* ===== MAP FRAME ===== */}
      <div className="fwm-frame">
        {/* Back arrow (inside map, top-left) */}
        {level >= 2 && (
          <button className="fwm-backbtn" onClick={goBack}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 16 6 10 12 4"/></svg>
            {level === 3 ? selGroup?.name : 'World Map'}
          </button>
        )}

        {/* LEVEL 1: WORLD MAP */}
        <div className={`fwm-world${level !== 1 ? ' fwm-world--hidden' : ''}`}>
          <div className="fwm-gridlines" />
          <span className="fwm-rlbl fwm-rlbl--first">— First Sea —</span>
          <span className="fwm-rlbl fwm-rlbl--second">— Second Sea —</span>
          <div className="fwm-compass" />

          {groupData.map(g => {
            const vis = visibleIds.has(g.id);
            return (
              <div key={g.id} className={`fwm-isle ${islandSizeCls(g.totalFish)}`}
                style={{ left: g.left, top: g.top, opacity: vis ? 1 : 0.15 }}
                onClick={() => vis && enterIsland(g.id)}>
                <div className="fwm-isle__wrap">
                  {g.imagePath ? (
                    <img src={g.imagePath} alt={g.name} className="fwm-isle__img" />
                  ) : (
                    <div className={`fwm-isle__ph fwm-biome--${g.biome}`}>
                      <span className="fwm-isle__emoji">{g.icon}</span>
                    </div>
                  )}
                </div>
                <span className="fwm-isle__lbl">{g.name}</span>
                {g.totalFish > 0 && <span className="fwm-isle__badge">{g.totalFish} fish</span>}
              </div>
            );
          })}
        </div>

        {/* LEVEL 2+3: ISLAND DETAIL */}
        <div className={`fwm-detail${level >= 2 ? ' fwm-detail--on' : ''}`}>
          {selGroup && (
            <>
              {/* Left: minimap */}
              <div className="fwm-mmap" onClick={() => { if (level === 3) { setSelSubId(null); setLevel(2); } }}>
                <div className="fwm-mmap__bg"
                  style={{ background: `linear-gradient(180deg, ${biome.fill} 0%, ${biome.fill}80 40%, #0a1f3a 100%)` }}>
                  <div className="fwm-gridlines" style={{ opacity: 0.02 }} />
                </div>

                {/* Island silhouette */}
                <svg className="fwm-sil" viewBox="0 0 340 220">
                  <path d={generateIslandPath(selGroup.name, 170, 110, 130, 85)}
                    fill={`${biome.fill}30`} stroke={`${biome.stroke}40`} strokeWidth="1" />
                  {/* Detail lines */}
                  <path d={generateIslandPath(selGroup.name, 170, 110, 130, 85)}
                    fill="none" stroke={`${biome.stroke}20`} strokeWidth="0.5"
                    strokeDasharray="4 6" transform="translate(2,2) scale(0.97)" />
                </svg>

                {/* Sub-location dots */}
                {selGroup.childLocs.map((loc, i) => {
                  const pos = subDots[i];
                  if (!pos) return null;
                  const active = selSubId === loc.id;
                  return (
                    <div key={loc.id}
                      className={`fwm-sdot${active ? ' fwm-sdot--on' : ''}`}
                      style={{ left: pos.left, top: pos.top }}
                      onClick={(e) => { e.stopPropagation(); selectSubzone(loc.id); }}>
                      <div className="fwm-sdot__ring" />
                      <div className="fwm-sdot__dot" />
                      <span className="fwm-sdot__name">{loc.name}</span>
                    </div>
                  );
                })}

                {/* Fish orbit (Level 3) */}
                {level === 3 && activeSubPos && (
                  <div className="fwm-orbit" style={{ left: activeSubPos.left, top: activeSubPos.top }}
                    onClick={(e) => e.stopPropagation()}>
                    {orbitFish.map((f, i) => {
                      const id = f.id || slugify(f.name);
                      const pos = orbitPos[i];
                      if (!pos) return null;
                      return (
                        <a key={`${f.name}-${i}`}
                          href={`/games/${gameSlug}/fish/${id}/`}
                          className="fwm-orbf"
                          style={{
                            left: `${pos.x - 26}px`, top: `${pos.y - 35}px`,
                            animationDelay: `${i * 0.05}s`,
                          }}>
                          <div className="fwm-orbf__img" style={{ ...rarBgSt(f.rarity), ...rarBorderSt(f.rarity) }}>
                            <img src={`/images/fish/${id}.png`} alt={f.name} loading="lazy" />
                          </div>
                          <span className="fwm-orbf__name">{f.name}</span>
                          <span className="fwm-orbf__rar" style={rarBadgeSt(f.rarity)}>{f.rarity}</span>
                        </a>
                      );
                    })}
                    {!showAllOrbit && extraOrbitCount > 0 && (
                      <button className="fwm-orbmore"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAllOrbit(true); }}>
                        +{extraOrbitCount} more
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right: info panel */}
              <div className="fwm-ipanel">
                <div className="fwm-ipanel__head">
                  <button className="fwm-ipanel__back" onClick={goBack}>
                    ← {level === 3 ? selGroup.name : 'Back to World Map'}
                  </button>
                  <div className="fwm-ipanel__title">{selGroup.icon} {selGroup.name}</div>
                  <div className="fwm-ipanel__meta">
                    <span className="fwm-ipanel__count">🐟 {selGroup.totalFish} fish</span>
                    <span>{selGroup.sea === 'second' ? 'Second Sea' : selGroup.sea === 'deep' ? 'Deep' : 'First Sea'}</span>
                    {selGroup.coords && (
                      <span className="fwm-ipanel__coords">X:{selGroup.coords.x} Z:{selGroup.coords.z}</span>
                    )}
                  </div>
                </div>

                {/* Weather */}
                {selGroup.weathers.length > 0 && (
                  <div className="fwm-ipanel__wx">
                    {selGroup.weathers.map(w => (
                      <span key={w} className={`fwm-wxc ${WX_CLS[w] || ''}`}>
                        {WX_ICO[w] || ''} {w}
                      </span>
                    ))}
                  </div>
                )}

                {/* Sub-zone list */}
                {selGroup.childLocs.length > 1 && (
                  <div className="fwm-ipanel__subs">
                    <div className="fwm-ipanel__slbl">Sub-locations</div>
                    {selGroup.childLocs.map(loc => (
                      <div key={loc.id}
                        className={`fwm-ipanel__sub${selSubId === loc.id ? ' fwm-ipanel__sub--on' : ''}`}
                        onClick={() => selectSubzone(loc.id)}>
                        <span className="fwm-ipanel__sdot" />
                        <span>{loc.name}</span>
                        <span className="fwm-ipanel__scnt">{loc.fishCount} fish</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Fish list */}
                <div className="fwm-ipanel__flist">
                  <div className="fwm-ipanel__flbl">
                    {selSubId && selSub ? `Fish in ${selSub.name}` : 'All Fish'}
                  </div>
                  {panelFish.length === 0 && <p className="fwm-ipanel__empty">No fish data available</p>}
                  {panelFish.map((f, i) => {
                    const id = f.id || slugify(f.name);
                    return (
                      <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${id}/`}
                        className="fwm-ipanel__fi">
                        <div className="fwm-ipanel__fimg" style={rarBgSt(f.rarity)}>
                          <img src={`/images/fish/${id}.png`} alt={f.name} loading="lazy" />
                        </div>
                        <span className="fwm-ipanel__fname">{f.name}</span>
                        <span className="fwm-ipanel__frar" style={rarBadgeSt(f.rarity)}>{f.rarity}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Events */}
      {eventLocs.length > 0 && (
        <div className="fwm-events">
          <div className="fwm-events__lbl">⚡ Event Locations</div>
          <div className="fwm-events__scroll">
            {eventLocs.map(loc => (
              <div key={loc.id} className="fwm-evtc" onClick={() => enterIsland(loc.id)}>
                <span className="fwm-evtc__icon">{EVENT_ICONS[loc.id] || '🎉'}</span>
                <span className="fwm-evtc__name">{loc.name}</span>
                <span className="fwm-evtc__status">ENDED</span>
                {loc.fishCount > 0 && <span className="fwm-evtc__fish">{loc.fishCount} fish</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
