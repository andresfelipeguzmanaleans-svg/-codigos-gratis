import { useState, useMemo, useEffect, useCallback } from 'react';

/* ================================================================
   FischWorldMap — 3-level drill-down interactive map
   Level 1: World map with ~20 island circles (images)
   Level 2: Island interior — sub-zones as image circles
   Level 3: Fish orbit around selected sub-zone
   Everything inside the same viewport.
   ================================================================ */

interface FishEntry { name: string; rarity: string; id?: string; }
interface MapLocation {
  id: string; name: string; fishCount: number;
  isPremium: boolean; isEvent: boolean; isSeasonal: boolean;
  coords: { x: number; z: number } | null;
  imagePath: string | null; fish: FishEntry[]; availableWeathers: string[];
}
interface Props { locations: MapLocation[]; gameSlug: string; }

/* ---- Rarity ---- */
const RAR_ORD: Record<string,number> = {
  'Divine Secret':17,'Gemstone':16,'Fragment':15,'Relic':14,'Apex':13,
  'Special':12,'Limited':11,'Extinct':10,'Secret':9,'Exotic':8,
  'Mythical':7,'Legendary':6,'Rare':5,'Unusual':4,'Uncommon':3,'Common':2,'Trash':1,
};
const RAR_CLR: Record<string,string> = {
  'Trash':'#808080','Common':'#94a3b8','Uncommon':'#22c55e','Unusual':'#6366f1',
  'Rare':'#3b82f6','Legendary':'#f97316','Mythical':'#ef4444','Exotic':'#a855f7',
  'Secret':'#06b6d4','Relic':'#CD7F32','Fragment':'#E056A0','Gemstone':'#00FFFF',
  'Extinct':'#9ca3af','Limited':'#facc15','Apex':'#FF4500','Special':'#FF69B4',
  'Divine Secret':'#FFE066',
};

function slug(n: string) { return n.toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
function bestRar(fish: FishEntry[]): string {
  let b = 'Common', bo = 0;
  for (const f of fish) { const o = RAR_ORD[f.rarity]||0; if (o > bo) { bo = o; b = f.rarity; } }
  return b;
}
function islSize(c: number) { return c >= 50 ? 'xl' : c >= 30 ? 'lg' : c >= 15 ? 'md' : 'sm'; }
function subSize(c: number) { return c >= 20 ? 'xl' : c >= 10 ? 'lg' : c >= 5 ? 'md' : 'sm'; }

/* ---- Blob clip-path for islands (organic outline, 0-100 coords) ---- */
function blobClipPath(name: string): string {
  const r = rng(hashStr(name + 'blob'));
  const n = 12;
  const pts: [number,number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const noise = 0.78 + r() * 0.44;
    pts.push([50 + Math.cos(a) * 46 * noise, 50 + Math.sin(a) * 46 * noise]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
    d += ` C${(p1[0]+(p2[0]-p0[0])/6).toFixed(1)},${(p1[1]+(p2[1]-p0[1])/6).toFixed(1)} ${(p2[0]-(p3[0]-p1[0])/6).toFixed(1)},${(p2[1]-(p3[1]-p1[1])/6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

/* Island image mapping */
const ISLE_IMG: Record<string,string> = {
  'sunstone-island': '/images/locations/sunstone-island.png',
  'northern-caves': '/images/locations/crimson-cavern.png',
  'castaway-cliffs': '/images/locations/castaway-cliffs.png',
  'emberreach': '/images/locations/emberreach.png',
  'ancient-isle': '/images/locations/ancient-isle.png',
  'keepers-altar': '/images/locations/ocean.png',
  'the-ocean': '/images/locations/ocean.png',
  'roslit-bay': '/images/locations/roslit-bay.png',
  'moosewood': '/images/locations/moosewood.png',
  'lushgrove': '/images/locations/lushgrove.png',
  'mushgrove-swamp': '/images/locations/mushgrove-swamp.png',
  'cursed-isle': '/images/locations/cursed-isle.png',
  'forsaken-shores': '/images/locations/forsaken-shores.png',
  'deep-trenches': '/images/locations/atlantis.png',
  'vertigo': '/images/locations/vertigo.png',
  'terrapin-island': '/images/locations/terrapin-island.png',
  'azure-lagoon': '/images/locations/azure-lagoon.png',
  'snowcap-island': '/images/locations/snowcap-island.png',
  'waveborne': '/images/locations/waveborne.png',
  'treasure-island': '/images/locations/treasure-island.png',
  'birch-cay': '/images/locations/balloon/balloon-birch-cay.png',
  'the-arch': '/images/locations/balloon/balloon-the-arch.png',
  'earmark-island': '/images/locations/balloon/balloon-earmark-island.png',
  'harvesters-spike': '/images/locations/balloon/balloon-harvesters-spike.png',
};

/* ---- Weather ---- */
const WX_CLS: Record<string,string> = {
  'Sunny':'fwm-wx--sun','Rain':'fwm-wx--rain','Thunder':'fwm-wx--thun',
  'Wind':'fwm-wx--wind','Foggy':'fwm-wx--fog','Blizzard':'fwm-wx--bliz',
  'Snow':'fwm-wx--snow','Any':'fwm-wx--any',
};
const WX_ICO: Record<string,string> = {
  'Sunny':'☀️','Rain':'🌧️','Thunder':'⛈️','Wind':'💨','Foggy':'🌫️',
  'Blizzard':'🌨️','Snow':'❄️','Any':'🌤️',
};

/* ---- Procedural shapes ---- */
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function islandPath(name: string, cx: number, cy: number, rx: number, ry: number): string {
  const r = rng(hashStr(name));
  const n = 12 + Math.floor(r() * 6);
  const pts: [number,number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const noise = 0.7 + r() * 0.6;
    pts.push([cx + Math.cos(a) * rx * noise, cy + Math.sin(a) * ry * noise]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
    d += ` C${(p1[0]+(p2[0]-p0[0])/6).toFixed(1)},${(p1[1]+(p2[1]-p0[1])/6).toFixed(1)} ${(p2[0]-(p3[0]-p1[0])/6).toFixed(1)},${(p2[1]-(p3[1]-p1[1])/6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

/* Sub-zone circle positions (% within minimap, spread for image circles) */
function subCirclePos(count: number, name: string): { left: string; top: string }[] {
  if (count === 0) return [];
  if (count === 1) return [{ left: '50%', top: '48%' }];
  const r = rng(hashStr(name + 'circ'));
  const spread = count <= 2 ? 20 : count <= 4 ? 24 : count <= 7 ? 27 : 30;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + r() * 0.3;
    const dist = spread * 0.5 + r() * spread * 0.5;
    return {
      left: `${(50 + Math.cos(a) * dist).toFixed(1)}%`,
      top: `${(48 + Math.sin(a) * dist * 0.65).toFixed(1)}%`,
    };
  });
}

/* Fish orbit positions (px offsets from center) */
function orbitPos(count: number): { x: number; y: number }[] {
  if (count === 0) return [];
  if (count <= 12) {
    const rad = count <= 4 ? 85 : count <= 7 ? 100 : count <= 10 ? 115 : 130;
    return Array.from({ length: count }, (_, i) => ({
      x: Math.cos((i/count) * Math.PI * 2 - Math.PI/2) * rad,
      y: Math.sin((i/count) * Math.PI * 2 - Math.PI/2) * rad * 0.75,
    }));
  }
  const inner = Math.ceil(count/2), outer = count - inner;
  const pos: { x: number; y: number }[] = [];
  for (let i = 0; i < inner; i++) {
    const a = (i/inner) * Math.PI * 2 - Math.PI/2;
    pos.push({ x: Math.cos(a)*90, y: Math.sin(a)*90*0.75 });
  }
  for (let i = 0; i < outer; i++) {
    const a = (i/outer) * Math.PI * 2 - Math.PI/2 + Math.PI/outer;
    pos.push({ x: Math.cos(a)*155, y: Math.sin(a)*155*0.75 });
  }
  return pos;
}

/* Rarity inline styles */
function rarBorder(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { borderColor: `${c}80` };
}
function rarBg(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `linear-gradient(135deg, ${c}30, ${c}0d)` };
}
function rarBadge(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `${c}25`, color: c };
}

/* ---- Biome colors ---- */
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

/* ---- Balloon aerial images ---- */
const BALLOON: Record<string,string> = {
  'moosewood': '/images/locations/balloon/balloon-moosewood.png',
  'roslit-bay': '/images/locations/balloon/balloon-roslit-bay.png',
  'snowcap-island': '/images/locations/balloon/balloon-snowcap-island.png',
  'sunstone-island': '/images/locations/balloon/balloon-sunstone.png',
  'mushgrove-swamp': '/images/locations/balloon/balloon-mushgrove.png',
  'terrapin-island': '/images/locations/balloon/balloon-terrapin.png',
  'ancient-isle': '/images/locations/balloon/balloon-ancient-isle.png',
  'forsaken-shores': '/images/locations/balloon/balloon-forsaken-shores.png',
  'castaway-cliffs': '/images/locations/balloon/balloon-castaway-cliffs.png',
  'keepers-altar': '/images/locations/balloon/balloon-statue-of-sovereignty.png',
  'birch-cay': '/images/locations/balloon/balloon-birch-cay.png',
  'the-arch': '/images/locations/balloon/balloon-the-arch.png',
  'earmark-island': '/images/locations/balloon/balloon-earmark-island.png',
  'harvesters-spike': '/images/locations/balloon/balloon-harvesters-spike.png',
};

/* ---- GPS → map position ---- */
const GPS_BOUNDS = { minX: -3800, maxX: 6300, minZ: -3400, maxZ: 3900 };
function gpsToPercent(gx: number, gz: number): { left: number; top: number } {
  // Compress X beyond ±3000 to reclaim space from outliers (Ancient Isle)
  const cx = gx > 3000 ? 3000 + (gx - 3000) * 0.4
           : gx < -3000 ? -3000 + (gx + 3000) * 0.4
           : gx;
  const rZ = GPS_BOUNDS.maxZ - GPS_BOUNDS.minZ; // 7300
  const rX = rZ * (16 / 9);                     // ~12978 (16:9 adjusted)
  const cMinX = -3000 + (GPS_BOUNDS.minX + 3000) * 0.4;
  const cMaxX = 3000 + (GPS_BOUNDS.maxX - 3000) * 0.4;
  const centerX = (cMinX + cMaxX) / 2;
  return {
    left: ((cx - (centerX - rX / 2)) / rX) * 94 + 3,
    top: ((gz - GPS_BOUNDS.minZ) / rZ) * 94 + 3,
  };
}
function gpsPos(gx: number, gz: number): { left: string; top: string } {
  const p = gpsToPercent(gx, gz);
  return {
    left: `${Math.max(3, Math.min(97, p.left)).toFixed(1)}%`,
    top: `${Math.max(3, Math.min(97, p.top)).toFixed(1)}%`,
  };
}

/* Collision resolution — nudge overlapping islands apart */
function resolveOverlaps(
  items: { left: string; top: string; w: number }[]
): { left: string; top: string }[] {
  const MW = 1100, MH = MW * 9 / 16;
  const pos = items.map(it => ({
    x: (parseFloat(it.left) / 100) * MW,
    y: (parseFloat(it.top) / 100) * MH,
    rw: it.w / 2 + 10,
    rh: it.w / 2 + 24,
  }));
  for (let iter = 0; iter < 40; iter++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i], b = pos[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ox = (a.rw + b.rw) - Math.abs(dx);
        const oy = (a.rh + b.rh) - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const push = ox / 2 + 1;
            if (dx >= 0) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
          } else {
            const push = oy / 2 + 1;
            if (dy >= 0) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
        }
      }
    }
    if (!moved) break;
    for (const p of pos) {
      p.x = Math.max(p.rw + 4, Math.min(MW - p.rw - 4, p.x));
      p.y = Math.max(p.rh + 4, Math.min(MH - p.rh - 4, p.y));
    }
  }
  return pos.map(p => ({
    left: `${(p.x / MW * 100).toFixed(1)}%`,
    top: `${(p.y / MH * 100).toFixed(1)}%`,
  }));
}

/* GPS grid tick values */
const GPS_X_TICKS = [-3000, -1000, 0, 1000, 3000, 5000];
const GPS_Z_TICKS = [-3000, -1000, 0, 1000, 3000];

/* ---- Island groups (GPS-positioned) ---- */
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; gps: { x: number; z: number };
  left: string; top: string; w: number;
  sea: 'first'|'second'|'deep';
}
const GROUPS: IslandGroup[] = [
  // --- Northern First Sea (negative Z = north) ---
  { id:'birch-cay', name:'Birch Cay', icon:'🌲', biome:'tropical', children:['birch-cay'], gps:{x:1448,z:-2351}, ...gpsPos(1448,-2351), w:65, sea:'first' },
  { id:'the-arch', name:'The Arch', icon:'🌉', biome:'sand', children:['the-arch'], gps:{x:981,z:-1834}, ...gpsPos(981,-1834), w:65, sea:'first' },
  { id:'castaway-cliffs', name:'Castaway Cliffs', icon:'🪨', biome:'tropical', children:['castaway-cliffs'], gps:{x:690,z:-1693}, ...gpsPos(690,-1693), w:65, sea:'first' },
  { id:'northern-caves', name:'Northern Caves', icon:'🦇', biome:'dark', children:['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], gps:{x:-1750,z:-1500}, ...gpsPos(-1750,-1500), w:90, sea:'deep' },
  { id:'sunstone-island', name:'Sunstone Island', icon:'☀️', biome:'sand', children:['sunstone-island','desolate-deep'], gps:{x:-870,z:-1100}, ...gpsPos(-870,-1100), w:75, sea:'first' },
  { id:'emberreach', name:'Emberreach', icon:'🔥', biome:'volcanic', children:['emberreach'], gps:{x:2300,z:-800}, ...gpsPos(2300,-800), w:65, sea:'first' },
  // --- Central First Sea ---
  { id:'the-ocean', name:'The Ocean', icon:'🌊', biome:'ocean', children:['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], gps:{x:0,z:-400}, ...gpsPos(0,-400), w:85, sea:'first' },
  { id:'lushgrove', name:'Lushgrove', icon:'🌿', biome:'tropical', children:['lushgrove'], gps:{x:1132,z:-388}, ...gpsPos(1132,-388), w:70, sea:'first' },
  { id:'mushgrove-swamp', name:'Mushgrove Swamp', icon:'🍄', biome:'swamp', children:['mushgrove-swamp'], gps:{x:2420,z:-270}, ...gpsPos(2420,-270), w:65, sea:'first' },
  { id:'harvesters-spike', name:"Harvester's Spike", icon:'⛏️', biome:'sand', children:['harvesters-spike'], gps:{x:-1463,z:58}, ...gpsPos(-1463,58), w:65, sea:'first' },
  { id:'moosewood', name:'Moosewood', icon:'🏠', biome:'tropical', children:['moosewood','executive-lake','isle-of-new-beginnings'], gps:{x:400,z:250}, ...gpsPos(400,250), w:110, sea:'first' },
  { id:'roslit-bay', name:'Roslit Bay', icon:'🌋', biome:'volcanic', children:['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], gps:{x:-1600,z:500}, ...gpsPos(-1600,500), w:110, sea:'first' },
  { id:'ancient-isle', name:'Ancient Isle', icon:'🏛️', biome:'sand', children:['ancient-isle'], gps:{x:6000,z:300}, ...gpsPos(6000,300), w:80, sea:'first' },
  // --- Southern First Sea ---
  { id:'earmark-island', name:'Earmark Island', icon:'🏷️', biome:'tropical', children:['earmark-island'], gps:{x:1195,z:971}, ...gpsPos(1195,971), w:55, sea:'first' },
  { id:'deep-trenches', name:'Deep Trenches', icon:'🕳️', biome:'dark', children:['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], gps:{x:-1800,z:1000}, ...gpsPos(-1800,1000), w:90, sea:'deep' },
  { id:'azure-lagoon', name:'Azure Lagoon', icon:'💎', biome:'ocean', children:['azure-lagoon'], gps:{x:1318,z:1113}, ...gpsPos(1318,1113), w:55, sea:'first' },
  { id:'cursed-isle', name:'Cursed Isle', icon:'💀', biome:'dark', children:['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], gps:{x:1800,z:1210}, ...gpsPos(1800,1210), w:85, sea:'first' },
  { id:'vertigo', name:'Vertigo', icon:'🌀', biome:'dark', children:['vertigo','the-depths'], gps:{x:-500,z:1400}, ...gpsPos(-500,1400), w:70, sea:'first' },
  { id:'forsaken-shores', name:'Forsaken Shores', icon:'🏝️', biome:'sand', children:['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], gps:{x:-2750,z:1450}, ...gpsPos(-2750,1450), w:100, sea:'first' },
  { id:'keepers-altar', name:"Keeper's Altar", icon:'⛩️', biome:'mystic', children:['keepers-altar'], gps:{x:-800,z:1800}, ...gpsPos(-800,1800), w:65, sea:'first' },
  { id:'terrapin-island', name:'Terrapin Island', icon:'🐢', biome:'tropical', children:['terrapin-island','pine-shoals','carrot-garden'], gps:{x:-96,z:1872}, ...gpsPos(-96,1872), w:95, sea:'first' },
  // --- Far south First Sea ---
  { id:'snowcap-island', name:'Snowcap Island', icon:'❄️', biome:'snow', children:['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], gps:{x:2625,z:2370}, ...gpsPos(2625,2370), w:110, sea:'first' },
  // --- Second Sea ---
  { id:'waveborne', name:'Waveborne', icon:'⛵', biome:'mystic', children:['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], gps:{x:2000,z:3500}, ...gpsPos(2000,3500), w:85, sea:'second' },
  { id:'treasure-island', name:'Treasure Island', icon:'💰', biome:'sand', children:['treasure-island'], gps:{x:3500,z:3700}, ...gpsPos(3500,3700), w:70, sea:'second' },
];

const EVENT_IDS = ['admin-events','fischfright-2025','winter-village','lego-event-2025','fischgiving-2025'];
const EVT_ICO: Record<string,string> = {
  'admin-events':'⭐','fischfright-2025':'🎃','winter-village':'🎄','lego-event-2025':'🧱','fischgiving-2025':'🦃',
};

/* ================================================================
   COMPONENT
   ================================================================ */
export default function FischWorldMap({ locations, gameSlug }: Props) {
  const locMap = useMemo(() => {
    const m = new Map<string, MapLocation>();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

  /* Enriched group data */
  const groups = useMemo(() => {
    return GROUPS.map(g => {
      const childLocs = g.children.map(id => locMap.get(id)).filter(Boolean) as MapLocation[];
      const allFish = childLocs.flatMap(l => l.fish);
      const totalFish = childLocs.reduce((s,l) => s + l.fishCount, 0);
      const primary = locMap.get(g.children[0]) || childLocs[0];
      const imagePath = primary?.imagePath || childLocs.find(l => l.imagePath)?.imagePath || null;
      const weathers = Array.from(new Set(childLocs.flatMap(l => l.availableWeathers)));
      const coords = primary?.coords || null;
      return { ...g, childLocs, allFish, totalFish, imagePath, weathers, coords,
        isPremium: childLocs.some(l => l.isPremium),
        isSeasonal: childLocs.some(l => l.isSeasonal),
        topRarity: allFish.length > 0 ? bestRar(allFish) : 'Common',
      };
    });
  }, [locMap]);

  /* Resolved positions (collision-free) */
  const resolvedPos = useMemo(() =>
    resolveOverlaps(groups.map(g => ({ left: g.left, top: g.top, w: g.w })))
  , [groups]);

  const eventLocs = useMemo(() =>
    EVENT_IDS.map(id => locMap.get(id)).filter(Boolean) as MapLocation[]
  , [locMap]);

  /* ---- State ---- */
  const [level, setLevel] = useState<1|2|3>(1);
  const [selGrpId, setSelGrpId] = useState<string|null>(null);
  const [selSubId, setSelSubId] = useState<string|null>(null);
  const [showAllOrbit, setShowAllOrbit] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [whereX, setWhereX] = useState('');
  const [whereY, setWhereY] = useState('');
  const [whereZ, setWhereZ] = useState('');
  const [marker, setMarker] = useState<{ left: string; top: string; nearest: string; dist: number } | null>(null);

  /* Selected group (or virtual for events) */
  const selGrp = useMemo(() => {
    if (!selGrpId) return null;
    const g = groups.find(g => g.id === selGrpId);
    if (g) return g;
    const loc = locMap.get(selGrpId);
    if (!loc) return null;
    return {
      id: loc.id, name: loc.name, icon: EVT_ICO[loc.id]||'📍',
      biome: 'dark', children: [loc.id], gps: { x: 0, z: 0 }, left: '0%', top: '0%', w: 80,
      sea: 'first' as const,
      childLocs: [loc], allFish: [...loc.fish], totalFish: loc.fishCount,
      imagePath: loc.imagePath, weathers: loc.availableWeathers,
      coords: loc.coords, isPremium: loc.isPremium, isSeasonal: loc.isSeasonal,
      topRarity: bestRar(loc.fish),
    };
  }, [selGrpId, groups, locMap]);

  const selSub = useMemo(() => selSubId ? locMap.get(selSubId) || null : null, [selSubId, locMap]);

  /* Panel fish list */
  const panelFish = useMemo(() => {
    if (!selGrp) return [];
    const fish = selSubId ? [...(locMap.get(selSubId)?.fish||[])] : [...selGrp.allFish];
    return fish.sort((a,b) => (RAR_ORD[b.rarity]||0)-(RAR_ORD[a.rarity]||0));
  }, [selGrp, selSubId, locMap]);

  /* Orbit fish (top 10 or all) */
  const oFish = useMemo(() => {
    if (!selSub) return [];
    const sorted = [...selSub.fish].sort((a,b) => (RAR_ORD[b.rarity]||0)-(RAR_ORD[a.rarity]||0));
    return showAllOrbit ? sorted : sorted.slice(0, 10);
  }, [selSub, showAllOrbit]);
  const extraOrbit = useMemo(() => !selSub || selSub.fish.length <= 10 ? 0 : selSub.fish.length - 10, [selSub]);

  /* ---- Navigation ---- */
  const enter = useCallback((id: string) => {
    setSelGrpId(id); setSelSubId(null); setShowAllOrbit(false); setLevel(2);
  }, []);
  const exit = useCallback(() => {
    setLevel(1);
    setTimeout(() => { setSelGrpId(null); setSelSubId(null); setShowAllOrbit(false); }, 450);
  }, []);
  const pickSub = useCallback((locId: string) => {
    if (selSubId === locId) { setSelSubId(null); setLevel(2); }
    else { setSelSubId(locId); setShowAllOrbit(false); setLevel(3); }
  }, [selSubId]);
  const back = useCallback(() => {
    if (level === 3) { setSelSubId(null); setLevel(2); }
    else if (level === 2) exit();
  }, [level, exit]);

  /* "Where Am I?" — find position on map */
  const findMe = useCallback(() => {
    const x = parseFloat(whereX), z = parseFloat(whereZ);
    if (isNaN(x) || isNaN(z)) return;
    const pos = gpsPos(x, z);
    let nearest = '', minDist = Infinity;
    for (const g of GROUPS) {
      const dx = g.gps.x - x, dz = g.gps.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) { minDist = dist; nearest = g.name; }
    }
    setMarker({ ...pos, nearest, dist: Math.round(minDist) });
  }, [whereX, whereZ]);

  /* Escape key */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && level > 1) back(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [back, level]);

  /* URL params */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groups.find(g => g.id === loc);
    if (direct) { enter(direct.id); return; }
    const parent = groups.find(g => g.children.includes(loc));
    if (parent) { setSelGrpId(parent.id); setSelSubId(loc); setLevel(3); }
  }, [groups]);

  /* Filtered groups */
  const visGroups = useMemo(() => groups.filter(g => {
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
  }), [groups, filter, search]);
  const visIds = useMemo(() => new Set(visGroups.map(g => g.id)), [visGroups]);

  /* Sub-zone circle positions */
  const subPos = useMemo(() => selGrp ? subCirclePos(selGrp.childLocs.length, selGrp.name) : [], [selGrp]);

  /* Orbit positions */
  const oPos = useMemo(() => orbitPos(oFish.length), [oFish.length]);

  const biome = selGrp ? BIOME[selGrp.biome] || BIOME.ocean : BIOME.ocean;
  const balloonUrl = selGrp ? BALLOON[selGrp.id] || null : null;

  /* Center position for Level 3 (selected sub moves here) */
  const CENTER = { left: '42%', top: '42%' };

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <div className="fwm">
      {/* Controls */}
      <div className="fwm-ctrls">
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

      {/* Where Am I? */}
      <div className="fwm-where">
        <span className="fwm-where__lbl">📍 Where Am I?</span>
        <div className="fwm-where__row">
          <input type="number" placeholder="X" value={whereX}
            onChange={e => setWhereX(e.target.value)} className="fwm-where__in"
            onKeyDown={e => e.key === 'Enter' && findMe()} />
          <input type="number" placeholder="Y" value={whereY}
            onChange={e => setWhereY(e.target.value)} className="fwm-where__in fwm-where__in--y" />
          <input type="number" placeholder="Z" value={whereZ}
            onChange={e => setWhereZ(e.target.value)} className="fwm-where__in"
            onKeyDown={e => e.key === 'Enter' && findMe()} />
          <button className="fwm-where__btn" onClick={findMe}>Find me</button>
          {marker && <button className="fwm-where__clr" onClick={() => setMarker(null)}>✕</button>}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="fwm-bread">
        {level === 1 ? (
          <span className="fwm-bread__c">🗺️ World Map</span>
        ) : (<>
          <a className="fwm-bread__a" onClick={exit}>🗺️ World Map</a>
          <span className="fwm-bread__s">›</span>
          {level === 2 ? (
            <span className="fwm-bread__c">{selGrp?.icon} {selGrp?.name}</span>
          ) : (<>
            <a className="fwm-bread__a" onClick={() => { setSelSubId(null); setLevel(2); }}>
              {selGrp?.icon} {selGrp?.name}
            </a>
            <span className="fwm-bread__s">›</span>
            <span className="fwm-bread__c">{selSub?.name}</span>
          </>)}
        </>)}
      </div>

      {/* ===== MAP FRAME ===== */}
      <div className="fwm-frame">
        {/* Back button */}
        {level >= 2 && (
          <button className="fwm-back" onClick={back}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="12 16 6 10 12 4"/></svg>
            {level === 3 ? selGrp?.name : 'World Map'}
          </button>
        )}

        {/* LEVEL 1: WORLD MAP */}
        <div className={`fwm-world${level!==1?' fwm-world--out':''}`}>
          <div className="fwm-grid"/>

          {/* Ocean waves */}
          <svg className="fwm-waves" viewBox="0 0 1000 600" preserveAspectRatio="none">
            {[100, 200, 310, 400, 480, 560].map((y, i) => (
              <path key={i}
                d={`M-20,${y} Q${150+i*20},${y-12-i*2} ${300+i*10},${y} T${620-i*10},${y} T${940+i*5},${y}`}
                fill="none" stroke={`rgba(255,255,255,${0.05 - i*0.006})`}
                strokeWidth={2 - i*0.2} strokeLinecap="round"/>
            ))}
          </svg>

          <span className="fwm-rl fwm-rl--1">— First Sea —</span>

          {/* Sea divider */}
          <div className="fwm-sea-div" style={{ top: `${gpsToPercent(0, 2900).top}%` }}>
            <span>Second Sea</span>
          </div>

          {/* Compass rose */}
          <svg className="fwm-compass" viewBox="0 0 60 60" width="44" height="44">
            <circle cx="30" cy="30" r="27" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
            <polygon points="30,7 33,25 30,21 27,25" fill="#ef4444" opacity="0.9"/>
            <polygon points="30,53 33,35 30,39 27,35" fill="rgba(255,255,255,0.25)"/>
            <polygon points="7,30 25,27 21,30 25,33" fill="rgba(255,255,255,0.2)"/>
            <polygon points="53,30 35,27 39,30 35,33" fill="rgba(255,255,255,0.2)"/>
            <text x="30" y="16" textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="700" fontFamily="inherit">N</text>
            <text x="30" y="49" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="6" fontWeight="600" fontFamily="inherit">S</text>
            <text x="13" y="33" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="6" fontWeight="600" fontFamily="inherit">W</text>
            <text x="47" y="33" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="6" fontWeight="600" fontFamily="inherit">E</text>
          </svg>

          {/* ===== GPS COORDINATE GRID ===== */}
          <svg className="fwm-gps-grid" viewBox="0 0 100 100" preserveAspectRatio="none">
            {GPS_X_TICKS.map(v => {
              const x = gpsToPercent(v, 0).left;
              return <line key={`gx${v}`} x1={x} y1={0} x2={x} y2={100}
                stroke={v === 0 ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)'}
                strokeWidth={v === 0 ? 0.3 : 0.15}
                strokeDasharray={v === 0 ? '1,0.5' : 'none'}/>;
            })}
            {GPS_Z_TICKS.map(v => {
              const y = gpsToPercent(0, v).top;
              return <line key={`gz${v}`} x1={0} y1={y} x2={100} y2={y}
                stroke={v === 0 ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.04)'}
                strokeWidth={v === 0 ? 0.3 : 0.15}
                strokeDasharray={v === 0 ? '1,0.5' : 'none'}/>;
            })}
          </svg>

          {/* X-axis labels (bottom) */}
          <div className="fwm-axis fwm-axis--x">
            {GPS_X_TICKS.map(v => (
              <span key={v} style={{ left: `${gpsToPercent(v, 0).left}%` }}>X:{v}</span>
            ))}
          </div>
          {/* Z-axis labels (left) */}
          <div className="fwm-axis fwm-axis--z">
            {GPS_Z_TICKS.map(v => (
              <span key={v} style={{ top: `${gpsToPercent(0, v).top}%` }}>Z:{v}</span>
            ))}
          </div>

          {/* ===== ISLAND NODES ===== */}
          {groups.map((g, gi) => {
            const vis = visIds.has(g.id);
            const b = BIOME[g.biome] || BIOME.ocean;
            const imgSrc = ISLE_IMG[g.id] || g.imagePath;
            const pos = resolvedPos[gi];
            const clipId = `clip-${g.id}`;
            const clipD = blobClipPath(g.name);
            return (
              <div key={g.id} className="fwm-isle"
                style={{
                  left: pos?.left || g.left, top: pos?.top || g.top,
                  width: g.w, height: g.w,
                  opacity: vis ? 1 : 0.15,
                }}
                onClick={() => vis && enter(g.id)}>
                <svg className="fwm-isle__svg" viewBox="-10 -10 120 120" preserveAspectRatio="none">
                  <defs>
                    <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                      <path d={clipD}/>
                    </clipPath>
                  </defs>
                  <g clipPath={`url(#${clipId})`}>
                    <rect x="-10" y="-10" width="120" height="120" fill={b.fill}/>
                    {imgSrc && (
                      <image href={imgSrc} x="-20" y="-20" width="140" height="140"
                        preserveAspectRatio="xMidYMid slice"/>
                    )}
                    <rect className="fwm-isle__ov" x="-10" y="-10" width="120" height="120"
                      fill={b.fill} opacity="0.25"/>
                  </g>
                </svg>
                <span className="fwm-isle__n" style={{ color: b.stroke }}>{g.name}</span>
                {g.totalFish > 0 && <span className="fwm-isle__f">{g.totalFish} fish</span>}
              </div>
            );
          })}

          {/* Where Am I? marker */}
          {marker && level === 1 && (
            <div className="fwm-marker" style={{ left: marker.left, top: marker.top }}>
              <div className="fwm-marker__dot"/>
              <div className="fwm-marker__tip">
                <strong>📍 You are here</strong><br/>
                Nearest: {marker.nearest}<br/>
                ~{marker.dist} studs away
              </div>
            </div>
          )}
        </div>

        {/* LEVEL 2+3: ISLAND DETAIL */}
        <div className={`fwm-det${level>=2?' fwm-det--on':''}`}>
          {selGrp && (<>
            {/* Full-frame balloon aerial background */}
            {balloonUrl && (
              <>
                <img src={balloonUrl} className="fwm-balloon" alt={selGrp.name} />
                <div className="fwm-balloon-ov"/>
              </>
            )}

            {/* Left: minimap with sub-zone image circles */}
            <div className="fwm-mm" onClick={() => level===3 && back()}>
              {/* Fallback gradient background when no balloon */}
              {!balloonUrl && (
                <div className="fwm-mm__bg"
                  style={{ background: `linear-gradient(180deg, ${biome.fill} 0%, ${biome.fill}80 40%, #0a1f3a 100%)` }}>
                  <div className="fwm-grid" style={{ opacity: 0.02 }}/>
                </div>
              )}

              {/* Procedural silhouette only when no balloon */}
              {!balloonUrl && (
                <svg className="fwm-sil" viewBox="0 0 340 220">
                  <path d={islandPath(selGrp.name, 170, 110, 130, 85)}
                    fill={`${biome.fill}25`} stroke={`${biome.stroke}30`} strokeWidth="1"/>
                </svg>
              )}

              {/* Sub-zone IMAGE circles */}
              {selGrp.childLocs.map((loc, i) => {
                const pos = subPos[i];
                if (!pos) return null;
                const isActive = selSubId === loc.id;
                const isL3 = level === 3;
                /* In Level 3: selected moves to center, others fade */
                const style: React.CSSProperties = {
                  left: isL3 && isActive ? CENTER.left : pos.left,
                  top: isL3 && isActive ? CENTER.top : pos.top,
                  opacity: isL3 && !isActive ? 0.12 : 1,
                  zIndex: isActive ? 5 : 2,
                };
                return (
                  <div key={loc.id}
                    className={`fwm-sub fwm-sub--${subSize(loc.fishCount)}${isActive?' fwm-sub--on':''}`}
                    style={style}
                    onClick={(e) => { e.stopPropagation(); pickSub(loc.id); }}>
                    <div className="fwm-sub__w">
                      {loc.imagePath
                        ? <img src={loc.imagePath} alt={loc.name} className="fwm-sub__img"/>
                        : <div className={`fwm-sub__ph fwm-b--${selGrp.biome}`}><span>📍</span></div>}
                    </div>
                    <span className="fwm-sub__n">{loc.name}</span>
                    {loc.fishCount > 0 && <span className="fwm-sub__f">{loc.fishCount} fish</span>}
                  </div>
                );
              })}

              {/* Fish orbit (Level 3) */}
              {level === 3 && selSubId && (
                <div className="fwm-orb" style={{ left: CENTER.left, top: CENTER.top }}
                  onClick={(e) => e.stopPropagation()}>
                  {oFish.map((f, i) => {
                    const id = f.id || slug(f.name);
                    const p = oPos[i];
                    if (!p) return null;
                    return (
                      <a key={`${f.name}-${i}`}
                        href={`/games/${gameSlug}/fish/${id}/`}
                        className="fwm-of"
                        style={{
                          left: `${p.x - 26}px`, top: `${p.y - 35}px`,
                          animationDelay: `${i * 0.05}s`,
                        }}>
                        <div className="fwm-of__img" style={{ ...rarBg(f.rarity), ...rarBorder(f.rarity) }}>
                          <img src={`/images/fish/${id}.png`} alt={f.name} loading="lazy"/>
                        </div>
                        <span className="fwm-of__n">{f.name}</span>
                        <span className="fwm-of__r" style={rarBadge(f.rarity)}>{f.rarity}</span>
                      </a>
                    );
                  })}
                  {!showAllOrbit && extraOrbit > 0 && (
                    <button className="fwm-of__more"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowAllOrbit(true); }}>
                      +{extraOrbit} more
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Right: info panel */}
            <div className="fwm-ip">
              <div className="fwm-ip__hd">
                <button className="fwm-ip__bk" onClick={back}>
                  ← {level===3 ? selGrp.name : 'Back to World Map'}
                </button>
                <div className="fwm-ip__ti">{selGrp.icon} {selGrp.name}</div>
                <div className="fwm-ip__meta">
                  <span className="fwm-ip__cnt">🐟 {selGrp.totalFish} fish</span>
                  <span>{selGrp.sea==='second'?'Second Sea':selGrp.sea==='deep'?'Deep':'First Sea'}</span>
                  {selGrp.coords && <span className="fwm-ip__xy">X:{selGrp.coords.x} Z:{selGrp.coords.z}</span>}
                </div>
              </div>

              {/* Weather */}
              {selGrp.weathers.length > 0 && (
                <div className="fwm-ip__wx">
                  {selGrp.weathers.map(w => (
                    <span key={w} className={`fwm-wxc ${WX_CLS[w]||''}`}>{WX_ICO[w]||''} {w}</span>
                  ))}
                </div>
              )}

              {/* Sub-zone list */}
              {selGrp.childLocs.length > 1 && (
                <div className="fwm-ip__sl">
                  <div className="fwm-ip__slbl">Sub-locations</div>
                  {selGrp.childLocs.map(loc => (
                    <div key={loc.id}
                      className={`fwm-ip__si${selSubId===loc.id?' fwm-ip__si--on':''}`}
                      onClick={() => pickSub(loc.id)}>
                      <span className="fwm-ip__sid"/>
                      <span>{loc.name}</span>
                      <span className="fwm-ip__sic">{loc.fishCount} fish</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Fish list */}
              <div className="fwm-ip__fl">
                <div className="fwm-ip__fll">
                  {selSubId && selSub ? `Fish in ${selSub.name}` : 'All Fish'}
                </div>
                {panelFish.length === 0 && <p className="fwm-ip__emp">No fish data available</p>}
                {panelFish.map((f, i) => {
                  const id = f.id || slug(f.name);
                  return (
                    <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${id}/`} className="fwm-ip__fi">
                      <div className="fwm-ip__fimg" style={rarBg(f.rarity)}>
                        <img src={`/images/fish/${id}.png`} alt={f.name} loading="lazy"/>
                      </div>
                      <span className="fwm-ip__fn">{f.name}</span>
                      <span className="fwm-ip__fr" style={rarBadge(f.rarity)}>{f.rarity}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          </>)}
        </div>
      </div>

      {/* Events */}
      {eventLocs.length > 0 && (
        <div className="fwm-ev">
          <div className="fwm-ev__lbl">⚡ Event Locations</div>
          <div className="fwm-ev__row">
            {eventLocs.map(loc => (
              <div key={loc.id} className="fwm-ec" onClick={() => enter(loc.id)}>
                <span className="fwm-ec__i">{EVT_ICO[loc.id]||'🎉'}</span>
                <span className="fwm-ec__n">{loc.name}</span>
                <span className="fwm-ec__s">ENDED</span>
                {loc.fishCount > 0 && <span className="fwm-ec__f">{loc.fishCount} fish</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
