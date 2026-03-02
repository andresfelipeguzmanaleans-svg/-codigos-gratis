import { useState, useMemo, useCallback, useEffect } from 'react';

/* ================================================================
   FischWorldMap — Painted map with island buttons (no zoom, no Leaflet)
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
  'Apex':17,'Divine Secret':16,'Gemstone':15,'Relic':14,'Exotic':13,
  'Secret':12,'Mythical':11,'Legendary':10,'Rare':9,'Unusual':8,
  'Uncommon':7,'Common':6,'Special':5,'Limited':4,'Extinct':3,'Fragment':2,'Trash':1,
};
const RAR_CLR: Record<string,string> = {
  'Trash':'#808080','Common':'#aaaaaa','Uncommon':'#44ff44','Unusual':'#6366f1',
  'Rare':'#44aaff','Legendary':'#aa44ff','Mythical':'#ff4444','Exotic':'#ffaa00',
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
function rarBg(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `linear-gradient(135deg, ${c}30, ${c}0d)` };
}
function rarBadge(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `${c}25`, color: c };
}

/* Island wiki images (for panel hero) */
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
  'birch-cay': '/images/locations/birch-cay.png',
  'the-arch': '/images/locations/the-arch.png',
  'earmark-island': '/images/locations/earmark-island.png',
  'harvesters-spike': '/images/locations/harvesters-spike.png',
  'statue-of-sovereignty': '/images/locations/statue-of-sovereignty.png',
  'the-laboratory': '/images/locations/the-laboratory.png',
};
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
  'statue-of-sovereignty': '/images/locations/balloon/balloon-statue-of-sovereignty.png',
  'the-laboratory': '/images/locations/balloon/balloon-laboratory.png',
};

/* Weather */
const WX_CLS: Record<string,string> = {
  'Sunny':'fwm-wx--sun','Rain':'fwm-wx--rain','Thunder':'fwm-wx--thun',
  'Wind':'fwm-wx--wind','Foggy':'fwm-wx--fog','Blizzard':'fwm-wx--bliz',
  'Snow':'fwm-wx--snow','Any':'fwm-wx--any',
};
const WX_ICO: Record<string,string> = {
  'Sunny':'☀️','Rain':'🌧️','Thunder':'⛈️','Wind':'💨','Foggy':'🌫️',
  'Blizzard':'🌨️','Snow':'❄️','Any':'🌤️',
};

/* Events */
const EVENT_IDS = ['admin-events','fischfright-2025','winter-village','lego-event-2025','fischgiving-2025'];
const EVT_ICO: Record<string,string> = {
  'admin-events':'⭐','fischfright-2025':'🎃','winter-village':'🎄','lego-event-2025':'🧱','fischgiving-2025':'🦃',
};

/* ---- Island groups ---- */
interface IslandGroup {
  id: string; name: string; icon: string;
  children: string[]; gps: { x: number; z: number };
  type: 'island'|'special';
  sea: 'first'|'second'|'deep';
  label?: string;
}

/* GPS coords from locations.json (scraped from game data) */
const GROUPS: IslandGroup[] = [
  { id:'moosewood', name:'Moosewood', icon:'🏠', children:['moosewood','executive-lake','isle-of-new-beginnings'], gps:{x:350,z:250}, type:'island', sea:'first' },
  { id:'roslit-bay', name:'Roslit Bay', icon:'🌋', children:['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], gps:{x:-1450,z:750}, type:'island', sea:'first' },
  { id:'snowcap-island', name:'Snowcap Island', icon:'❄️', children:['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], gps:{x:2600,z:2400}, type:'island', sea:'first' },
  { id:'terrapin-island', name:'Terrapin Island', icon:'🐢', children:['terrapin-island','pine-shoals','carrot-garden'], gps:{x:-200,z:1925}, type:'island', sea:'first' },
  { id:'forsaken-shores', name:'Forsaken Shores', icon:'🏝️', children:['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], gps:{x:-2425,z:1555}, type:'island', sea:'first' },
  { id:'cursed-isle', name:'Cursed Isle', icon:'💀', children:['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], gps:{x:1860,z:1210}, type:'island', sea:'first' },
  { id:'sunstone-island', name:'Sunstone Island', icon:'☀️', children:['sunstone-island','desolate-deep'], gps:{x:-935,z:-1105}, type:'island', sea:'first' },
  { id:'ancient-isle', name:'Ancient Isle', icon:'🏛️', children:['ancient-isle'], gps:{x:5833,z:401}, type:'island', sea:'first' },
  { id:'mushgrove-swamp', name:'Mushgrove Swamp', icon:'🍄', children:['mushgrove-swamp'], gps:{x:2425,z:-670}, type:'island', sea:'first' },
  { id:'lushgrove', name:'Lushgrove', icon:'🌿', children:['lushgrove'], gps:{x:1133,z:-560}, type:'island', sea:'first' },
  { id:'emberreach', name:'Emberreach', icon:'🔥', children:['emberreach'], gps:{x:2390,z:-490}, type:'island', sea:'first' },
  { id:'northern-caves', name:'Northern Caves', icon:'🦇', children:['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], gps:{x:-1035,z:-4800}, type:'island', sea:'deep' },
  { id:'birch-cay', name:'Birch Cay', icon:'🌲', children:['birch-cay'], gps:{x:1448,z:-2351}, type:'island', sea:'first' },
  { id:'earmark-island', name:'Earmark Island', icon:'🏷️', children:['earmark-island'], gps:{x:1195,z:971}, type:'island', sea:'first' },
  { id:'castaway-cliffs', name:'Castaway Cliffs', icon:'🪨', children:['castaway-cliffs'], gps:{x:690,z:-1693}, type:'island', sea:'first' },
  { id:'harvesters-spike', name:"Harvester's Spike", icon:'⛏️', children:['harvesters-spike'], gps:{x:-1463,z:58}, type:'island', sea:'first' },
  { id:'the-arch', name:'The Arch', icon:'🌉', children:['the-arch'], gps:{x:981,z:-1834}, type:'island', sea:'first' },
  { id:'statue-of-sovereignty', name:'Statue of Sovereignty', icon:'🗽', children:['statue-of-sovereignty'], gps:{x:37,z:-1017}, type:'island', sea:'first' },
  { id:'the-laboratory', name:'The Laboratory', icon:'🔬', children:['the-laboratory'], gps:{x:-400,z:-700}, type:'island', sea:'first' },
  { id:'waveborne', name:'Waveborne', icon:'⛵', children:['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], gps:{x:360,z:780}, type:'island', sea:'second' },
  { id:'treasure-island', name:'Treasure Island', icon:'💰', children:['treasure-island'], gps:{x:8582,z:-17304}, type:'island', sea:'second' },
  // Special zones (used for "Where Am I?" lookup, not shown on map)
  { id:'the-ocean', name:'The Ocean', icon:'🌊', children:['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], gps:{x:0,z:-800}, type:'special', sea:'first' },
  { id:'deep-trenches', name:'Deep Ocean', icon:'🔱', children:['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], gps:{x:1000,z:-3000}, type:'special', sea:'deep' },
  { id:'vertigo', name:'Vertigo', icon:'🌀', label:'Random loc', children:['vertigo','the-depths'], gps:{x:-110,z:1040}, type:'special', sea:'first' },
  { id:'azure-lagoon', name:'Azure Lagoon', icon:'💧', children:['azure-lagoon'], gps:{x:1310,z:2113}, type:'special', sea:'first' },
  { id:'keepers-altar', name:"Keeper's Altar", icon:'⛩️', label:'Under Statue', children:['keepers-altar'], gps:{x:-950,z:-1050}, type:'special', sea:'first' },
];

/* ---- Pin positions (center of each island as % of map) ----
   From fisch-map-final.html reference */
const PIN_POS: Record<string, { left: string; top: string }> = {
  'northern-caves':        { left: '13%',    top: '5.4%' },
  'sunstone-island':       { left: '17%',    top: '11.2%' },
  'roslit-bay':            { left: '17%',    top: '38.5%' },
  'statue-of-sovereignty': { left: '44%',    top: '23.3%' },
  'the-laboratory':        { left: '38.5%',  top: '18.8%' },
  'castaway-cliffs':       { left: '47%',    top: '12.1%' },
  'the-arch':              { left: '50%',    top: '26%' },
  'birch-cay':             { left: '55%',    top: '12.1%' },
  'lushgrove':             { left: '57%',    top: '27.3%' },
  'emberreach':            { left: '72%',    top: '17.9%' },
  'mushgrove-swamp':       { left: '86%',    top: '14.3%' },
  'harvesters-spike':      { left: '22%',    top: '59.1%' },
  'moosewood':             { left: '42%',    top: '45.7%' },
  'earmark-island':        { left: '66%',    top: '41.2%' },
  'cursed-isle':           { left: '67%',    top: '54.7%' },
  'ancient-isle':          { left: '97.5%',  top: '44.8%' },
  'forsaken-shores':       { left: '12%',    top: '75.3%' },
  'terrapin-island':       { left: '37%',    top: '71.7%' },
  'snowcap-island':        { left: '69%',    top: '78%' },
};

/* ---- Entrance diamonds (physical entrances to hidden zones on the map) ---- */
const ENTRANCES = [
  { id: 'keepers-altar', name: "Keeper's Altar", icon: '\u26E9\uFE0F', left: 43, top: 30, parentPin: 'statue-of-sovereignty' },
  { id: 'desolate-deep', name: 'Desolate Deep', icon: '\uD83D\uDD73\uFE0F', left: 14, top: 3, parentPin: 'sunstone-island' },
  { id: 'grand-reef', name: 'Grand Reef', icon: '\uD83E\uDEB8', left: 4, top: 40, parentPin: 'roslit-bay' },
  { id: 'n-expedition', name: 'N. Expedition', icon: '\u2744\uFE0F', left: 8, top: 88 },
] as const;

/* Gateway notes shown in island info panels */
const GATEWAYS: Record<string, { target: string; targetId: string; fish: string }> = {
  'roslit-bay': { target: "Mariana\u2019s Veil", targetId: 'marianas-veil', fish: '50+' },
  'grand-reef': { target: 'Atlantis', targetId: 'atlantis', fish: '59' },
};

/* Biome colors for pins (from reference) */
const BIOME_CLR: Record<string, string> = {
  'moosewood':'#22c55e', 'terrapin-island':'#22c55e', 'lushgrove':'#16a34a', 'birch-cay':'#22c55e',
  'roslit-bay':'#ef4444', 'emberreach':'#dc2626',
  'cursed-isle':'#7c3aed', 'mushgrove-swamp':'#a855f7',
  'the-arch':'#6b7280', 'harvesters-spike':'#374151', 'earmark-island':'#9ca3af',
  'castaway-cliffs':'#6b7280', 'statue-of-sovereignty':'#4b5563', 'the-laboratory':'#6b7280',
  'northern-caves':'#3b82f6', 'snowcap-island':'#60a5fa', 'waveborne':'#8b5cf6',
  'sunstone-island':'#f97316', 'ancient-isle':'#d97706',
  'forsaken-shores':'#1f2937',
  'treasure-island':'#eab308',
};

/* Pin icons */
const PIN_ICON: Record<string, string> = {
  'moosewood':'🏠','roslit-bay':'🌋','mushgrove-swamp':'🍄','snowcap-island':'🏔️',
  'forsaken-shores':'💀','cursed-isle':'🔮','ancient-isle':'🏛️','terrapin-island':'🏖️',
  'lushgrove':'🌿','emberreach':'🔥','statue-of-sovereignty':'🗿','the-laboratory':'🏭',
  'northern-caves':'⛰️','sunstone-island':'🌵','harvesters-spike':'🪨',
  'castaway-cliffs':'🧱','the-arch':'🌉','birch-cay':'🌳','earmark-island':'📦',
  'treasure-island':'💰','waveborne':'🌊',
};

/* ---- Hidden Zones panel data (3 blocks) ---- */
const OCEAN_ZONES = [
  { id: 'the-ocean', name: 'The Ocean', icon: '🌊', fish: '100+',
    access: 'Fish from any boat in open sea between islands' },
  { id: 'deep-trenches', name: 'Deep Ocean', icon: '🌊', fish: '~20',
    access: 'Sail to map edge, far from all islands' },
  { id: 'atlantean-storm', name: 'Atlantean Storm', icon: '⛈️', fish: '8',
    access: 'Whirlpools near Grand Reef. Fish inside storm circles' },
];
const QUEST_ZONES = [
  { id: 'keepers-altar', name: "Keeper’s Altar", icon: '⛩️', fish: '5',
    access: 'Under Statue of Sovereignty. Climb ladder → Sovereignty Mines → pay 400C$ to Cole → elevator down' },
  { id: 'desolate-deep', name: 'Desolate Deep', icon: '🕳️', fish: '11+',
    access: 'Buoy north of Sunstone (GPS: -791, 142, -3102). Diving Gear required. Dive through seafloor hole → cave with mines' },
  { id: 'vertigo', name: 'Vertigo', icon: '🌀', fish: '8',
    access: 'Jump into Strange Whirlpool (random spawn ~15 min near Moosewood/Forsaken/Roslit). Need Conception Conch (444C$) to exit' },
  { id: 'the-depths', name: 'The Depths', icon: '🔴', fish: '8+',
    access: "Inside Vertigo. Door at bottom of Vertigo’s Dip. Requires 100% Vertigo bestiary + Depths Key (fished in Vertigo)" },
  { id: 'n-expedition', name: 'N. Expedition', icon: '❄️', fish: '36+',
    access: 'Portal in southern ocean (GPS: -1733, 137, 3820). Ice mountain area. Needs Oxygen Tank + Winter Cloak. 5 sub-zones' },
  { id: 'grand-reef', name: 'Grand Reef', icon: '🪸', fish: '8',
    access: 'Island west of Roslit Bay (GPS: -3576, 151, 523). Permanent storm + lightning' },
  { id: 'atlantis', name: 'Atlantis', icon: '🏛️', fish: '59',
    access: 'Grand Reef: 10k C$ pirate → 5 levers Forsaken Shores → TNT from skull → submarine door → Heart of Zeus at night → central island crack' },
  { id: 'marianas-veil', name: "Mariana’s Veil", icon: '🌑', fish: '50+',
    access: 'Roslit Bay: Dr. Glimmerfin → build submarine (drill 5 obsidian rocks) → underwater cave. 5 layers. Boss: Scylla' },
];
const SPECIAL_ACCESS = [
  { id: 'treasure-island', name: 'Treasure Island', icon: '💰', fish: '21',
    access: 'Crazy Man in Isle of New Beginnings → Tornado event → Golden Whale → 90s ride. GPS: 8582, 175, -17304' },
  { id: 'waveborne', name: 'Waveborne', icon: '🌊', fish: '22',
    access: 'Second Sea via Sea Traveler in Terrapin → boss Cthulhu. Req: Level 250. (Second Sea removed Aug 2025, content relocated)' },
  { id: 'azure-lagoon', name: 'Azure Lagoon', icon: '💧', fish: '12',
    access: 'Second Sea, SW of Waveborne. Same access as Waveborne. Req: Level 250 + Cthulhu' },
];

/* Top fish by rarity */
function topFish(allFish: FishEntry[], max: number): FishEntry[] {
  return [...allFish].sort((a, b) => (RAR_ORD[b.rarity]||0) - (RAR_ORD[a.rarity]||0)).slice(0, max);
}

/* ================================================================
   COMPONENT
   ================================================================ */
export default function FischWorldMap({ locations, gameSlug }: Props) {
  const locMap = useMemo(() => {
    const m = new Map<string, MapLocation>();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

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

  const eventLocs = useMemo(() =>
    EVENT_IDS.map(id => locMap.get(id)).filter(Boolean) as MapLocation[]
  , [locMap]);

  /* State */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [whereX, setWhereX] = useState('');
  const [whereZ, setWhereZ] = useState('');
  const [marker, setMarker] = useState<{ nearestId: string; nearest: string; dist: number } | null>(null);
  const [whereOpen, setWhereOpen] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);

  /* Panel data */
  const panelData = useMemo(() => {
    if (!selectedId) return null;
    const grp = groups.find(g => g.id === selectedId);
    if (grp) {
      const fish = [...grp.allFish].sort((a, b) => (RAR_ORD[b.rarity]||0) - (RAR_ORD[a.rarity]||0));
      const heroImg = BALLOON[grp.id] || ISLE_IMG[grp.id] || grp.imagePath || null;
      return { type: 'group' as const, group: grp, location: null as MapLocation | null, fish, heroImg };
    }
    const loc = locMap.get(selectedId);
    if (loc) {
      const parentGroup = groups.find(g => g.children.includes(selectedId));
      const fish = [...loc.fish].sort((a, b) => (RAR_ORD[b.rarity]||0) - (RAR_ORD[a.rarity]||0));
      const heroImg = loc.imagePath || (parentGroup ? BALLOON[parentGroup.id] || ISLE_IMG[parentGroup.id] : null);
      return { type: 'location' as const, group: parentGroup || null, location: loc, fish, heroImg };
    }
    return null;
  }, [selectedId, groups, locMap]);

  const selectItem = useCallback((id: string) => {
    setSelectedId(prev => {
      if (prev !== id) setPanelExpanded(false);
      return prev === id ? null : id;
    });
  }, []);
  const closePanel = useCallback(() => { setSelectedId(null); setPanelExpanded(false); }, []);

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

  /* Where Am I — find nearest island pin */
  const findMe = useCallback(() => {
    const x = parseFloat(whereX), z = parseFloat(whereZ);
    if (isNaN(x) || isNaN(z)) return;
    let nearestId = '', nearest = '', minDist = Infinity;
    for (const g of GROUPS) {
      if (!PIN_POS[g.id]) continue; // only physical islands
      const dx = g.gps.x - x, dz = g.gps.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) { minDist = dist; nearestId = g.id; nearest = g.name; }
    }
    setMarker({ nearestId, nearest, dist: Math.round(minDist) });
  }, [whereX, whereZ]);

  /* Escape → close panel */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [closePanel]);

  /* URL params */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groups.find(g => g.id === loc);
    if (direct) { setSelectedId(direct.id); return; }
    const parent = groups.find(g => g.children.includes(loc));
    if (parent) setSelectedId(loc);
  }, [groups]);

  /* ================================================================
     RENDER
     ================================================================ */
  return (
    <div className="fwm">
      {/* Controls */}
      <div className="fwm-ctrls">
        <div className="fwm-pills">
          {(['all','first','second','deep'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`fwm-pill${filter===f?' fwm-pill--on':''}`}>
              {f==='all'?'All':f==='first'?'First Sea':f==='second'?'Second Sea':'Deep'}
            </button>
          ))}
          <button className={`fwm-pill fwm-pill--hz${hiddenOpen?' fwm-pill--on':''}`}
            onClick={() => setHiddenOpen(!hiddenOpen)}>
            🔮 Hidden Zones
          </button>
          <button className={`fwm-pill fwm-pill--wh${whereOpen?' fwm-pill--on':''}`}
            onClick={() => setWhereOpen(!whereOpen)}>
            📍 Where Am I?
          </button>
        </div>
        <input type="text" className="fwm-search" placeholder="Search island or fish..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Where Am I (inline below controls) */}
      {whereOpen && (
        <div className="fwm-where">
          <div className="fwm-where__row">
            <input type="number" placeholder="X" value={whereX}
              onChange={e => setWhereX(e.target.value)} className="fwm-where__in"
              onKeyDown={e => e.key === 'Enter' && findMe()} />
            <input type="number" placeholder="Z" value={whereZ}
              onChange={e => setWhereZ(e.target.value)} className="fwm-where__in"
              onKeyDown={e => e.key === 'Enter' && findMe()} />
            <button className="fwm-where__btn" onClick={findMe}>Find</button>
          </div>
          {marker && (
            <div className="fwm-where__result">
              {marker.dist > 1000
                ? <>Far from islands &middot; nearest: <strong>{marker.nearest}</strong> (~{marker.dist} studs)</>
                : <>Near <strong>{marker.nearest}</strong> (~{marker.dist} studs)</>
              }
              <button className="fwm-where__clr" onClick={() => setMarker(null)}>✕</button>
            </div>
          )}
        </div>
      )}

      {/* ===== MAP FRAME ===== */}
      <div className="fwm-frame" onClick={closePanel}>
       <div className="fwm-map">
        <img src="/images/map/fisch-world-map.png" alt="Fisch World Map" className="fwm-map__img" />

        {/* Dark overlay when island selected */}
        {selectedId && <div className="fwm-overlay" />}

        {/* Island pin markers */}
        {groups.filter(g => g.type === 'island' && PIN_POS[g.id]).map(g => {
          const pos = PIN_POS[g.id];
          const isActive = selectedId === g.id;
          const isHovered = hoveredId === g.id;
          const isVisible = visIds.has(g.id);
          const orbitFish = isActive ? [...g.allFish].sort((a, b) => (RAR_ORD[b.rarity]||0) - (RAR_ORD[a.rarity]||0)).slice(0, 48) : [];
          const seaLabel = g.sea === 'second' ? 'Second Sea' : g.sea === 'deep' ? 'Deep' : 'First Sea';
          const pinColor = BIOME_CLR[g.id] || '#6b7280';
          const isLocated = marker?.nearestId === g.id;
          const zoneRadius = isLocated
            ? marker.dist < 100 ? 30 : marker.dist < 500 ? 60 : marker.dist < 1000 ? 100 : 140
            : 0;

          return (
            <div key={g.id} className={`fwm-pin-area${isActive ? ' fwm-pin-area--on' : ''}${isLocated ? ' fwm-pin-area--located' : ''}`}
              style={{ left: pos.left, top: pos.top, opacity: isVisible ? 1 : 0.15 }}
              onClick={e => { e.stopPropagation(); selectItem(g.id); }}
              onMouseEnter={() => setHoveredId(g.id)}
              onMouseLeave={() => setHoveredId(null)}>

              <div className="fwm-pin-hit" />

              {/* Where Am I zone circle */}
              {isLocated && (
                <div className="fwm-zone" style={{ width: zoneRadius * 2, height: zoneRadius * 2 }} />
              )}

              <div className={`fwm-pin${isActive ? ' fwm-pin--on' : ''}${isLocated ? ' fwm-pin--located' : ''}`}
                style={{ '--pin-clr': pinColor } as React.CSSProperties}>
                <span className="fwm-pin__ico">{PIN_ICON[g.id] || g.icon}</span>
                <div className="fwm-pin__tip" />
              </div>

              <span className="fwm-pin__name">{g.name}</span>
              {g.totalFish > 0 && <span className="fwm-pin__fish">{g.totalFish} fish</span>}

              {isHovered && !isActive && (
                <div className="fwm-tooltip">
                  <strong>{g.name}</strong>
                  <div className="fwm-tooltip__meta">{g.totalFish} fish &middot; {seaLabel}</div>
                  {g.weathers.length > 0 && (
                    <div className="fwm-tooltip__wx">
                      {g.weathers.map(w => WX_ICO[w] || '').join(' ')}
                    </div>
                  )}
                  <div className="fwm-tooltip__cta">Click to explore &rarr;</div>
                  <div className="fwm-tooltip__arrow" />
                </div>
              )}

              {orbitFish.length > 0 && (() => {
                /* Build concentric rings: each outer ring fits more fish */
                const rings: { start: number; count: number; radius: number }[] = [];
                let placed = 0;
                for (let r = 0; placed < orbitFish.length; r++) {
                  const capacity = 8 + r * 3;          /* 8, 11, 14, 17, 20 ... */
                  const count = Math.min(capacity, orbitFish.length - placed);
                  const radius = 46 + r * 28;          /* 46, 74, 102, 130, 158 */
                  rings.push({ start: placed, count, radius });
                  placed += count;
                }
                return (
                  <div className="fwm-orbit">
                    {rings.map((ring) =>
                      orbitFish.slice(ring.start, ring.start + ring.count).map((f, i) => {
                        const deg = Math.round((360 / ring.count) * i - 90);
                        const fid = f.id || slug(f.name);
                        const rc = RAR_CLR[f.rarity] || '#aaa';
                        return (
                          <a key={fid + ring.start + i} href={`/games/${gameSlug}/fish/${fid}/`}
                            className="fwm-fdot"
                            onClick={e => e.stopPropagation()}
                            style={{ transform: `rotate(${deg}deg) translateX(${ring.radius}px) rotate(${-deg}deg)` }}>
                            <div className="fwm-fdot__wrap" style={{ borderColor: rc }}>
                              <img src={`/images/fish/${fid}.png`} alt={f.name} loading="lazy" />
                            </div>
                            <div className="fwm-fdot__tip">
                              <strong>{f.name}</strong>
                              <span className="fwm-fdot__rar" style={{ color: rc, background: `${rc}20` }}>{f.rarity}</span>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}


        {/* ---- Entrance dashed connecting lines (SVG overlay) ---- */}
        <svg className="fwm-ent-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {ENTRANCES.filter(e => e.parentPin && PIN_POS[e.parentPin]).map(ent => {
            const p = PIN_POS[ent.parentPin!];
            return (
              <line key={ent.id}
                x1={ent.left} y1={ent.top}
                x2={parseFloat(p.left)} y2={parseFloat(p.top)}
                stroke="rgba(168,85,247,0.45)"
                strokeWidth="0.25"
                strokeDasharray="0.8,0.5"
              />
            );
          })}
        </svg>

        {/* ---- Entrance diamond markers ---- */}
        {ENTRANCES.map(ent => (
          <div key={ent.id}
            className={`fwm-ent${hiddenOpen ? ' fwm-ent--glow' : ''}${selectedId === ent.id ? ' fwm-ent--on' : ''}`}
            style={{ left: `${ent.left}%`, top: `${ent.top}%` }}
            onClick={e => { e.stopPropagation(); selectItem(ent.id); }}>
            <div className="fwm-ent__diamond">
              <span className="fwm-ent__ico">{ent.icon}</span>
            </div>
            <span className="fwm-ent__name">{ent.name}</span>
          </div>
        ))}

       </div>{/* end .fwm-map */}

        {/* ===== HIDDEN ZONES PANEL (left) ===== */}
        <div className={`fwm-hp${hiddenOpen ? ' fwm-hp--open' : ''}`} onClick={e => e.stopPropagation()}>
          <button className="fwm-hp__close" onClick={() => setHiddenOpen(false)}>✕</button>
          <h3 className="fwm-hp__title">🔮 Hidden Zones</h3>

          <div className="fwm-hp__sec">
            <div className="fwm-hp__lbl">🌊 Ocean Zones</div>
            {OCEAN_ZONES.map(z => (
              <div key={z.id} className="fwm-hzc"
                onClick={() => { selectItem(z.id); setHiddenOpen(false); }}>
                <div className="fwm-hzc__hd">
                  <span className="fwm-hzc__i">{z.icon}</span>
                  <div>
                    <span className="fwm-hzc__n">{z.name}</span>
                    <span className="fwm-hzc__f">{z.fish} fish</span>
                  </div>
                </div>
                <p className="fwm-hzc__a">{z.access}</p>
              </div>
            ))}
          </div>

          <div className="fwm-hp__sec">
            <div className="fwm-hp__lbl">🔒 Quest Zones</div>
            {QUEST_ZONES.map(z => (
              <div key={z.id} className="fwm-hzc fwm-hzc--hid"
                onClick={() => { selectItem(z.id); setHiddenOpen(false); }}>
                <div className="fwm-hzc__hd">
                  <span className="fwm-hzc__i">{z.icon}</span>
                  <div>
                    <span className="fwm-hzc__n">{z.name}</span>
                    <span className="fwm-hzc__f">{z.fish} fish</span>
                  </div>
                </div>
                <p className="fwm-hzc__a">{z.access}</p>
              </div>
            ))}
          </div>

          <div className="fwm-hp__sec">
            <div className="fwm-hp__lbl">🚢 Special Access</div>
            {SPECIAL_ACCESS.map(z => (
              <div key={z.id} className="fwm-hzc fwm-hzc--lock"
                onClick={() => { selectItem(z.id); setHiddenOpen(false); }}>
                <div className="fwm-hzc__hd">
                  <span className="fwm-hzc__i">{z.icon}</span>
                  <div>
                    <span className="fwm-hzc__n">{z.name}</span>
                    <span className="fwm-hzc__f">{z.fish} fish</span>
                  </div>
                </div>
                <p className="fwm-hzc__a">{z.access}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ===== INFO PANEL ===== */}
        <div className={`fwm-panel${panelData ? ' fwm-panel--open' : ''}${panelExpanded ? ' fwm-panel--exp' : ''}`} onClick={e => e.stopPropagation()}>
          {panelData && (() => {
            const isGroup = panelData.type === 'group';
            const grp = panelData.group;
            const loc = panelData.location;
            const name = isGroup ? grp!.name : loc!.name;
            const icon = isGroup ? grp!.icon : (grp?.icon || '📍');
            const totalFish = isGroup ? grp!.totalFish : loc!.fishCount;
            const sea = grp ? (grp.sea === 'second' ? 'Second Sea' : grp.sea === 'deep' ? 'Deep' : 'First Sea') : '';
            const coords = isGroup ? grp!.coords : loc!.coords;
            const weathers = isGroup ? grp!.weathers : loc!.availableWeathers;
            const childLocs = isGroup && grp ? grp.childLocs : [];
            const heroImg = panelData.heroImg;

            return (
              <>
                <div className="fwm-panel__hd">
                  <button className="fwm-panel__close" onClick={closePanel}>✕</button>
                  {heroImg && (
                    <div className="fwm-panel__hero-wrap">
                      <img src={heroImg} alt={name} className="fwm-panel__hero"/>
                      <div className="fwm-panel__hero-ov"/>
                    </div>
                  )}
                  <div className="fwm-panel__hd-text">
                    <h2 className="fwm-panel__title">{icon} {name}</h2>
                    <div className="fwm-panel__meta">
                      <span className="fwm-panel__cnt">🐟 {totalFish} fish</span>
                      {sea && <span>{sea}</span>}
                      {coords && <span className="fwm-panel__xy">X:{coords.x} Z:{coords.z}</span>}
                    </div>
                    {!isGroup && grp && (
                      <button className="fwm-panel__parent" onClick={() => setSelectedId(grp.id)}>
                        ← {grp.icon} {grp.name}
                      </button>
                    )}
                  </div>
                </div>

                {weathers.length > 0 && (
                  <div className="fwm-panel__wx">
                    {weathers.map(w => (
                      <span key={w} className={`fwm-wxc ${WX_CLS[w]||''}`}>{WX_ICO[w]||''} {w}</span>
                    ))}
                  </div>
                )}

                <button className="fwm-panel__expand" onClick={(e) => { e.stopPropagation(); setPanelExpanded(true); }}>
                  {'\uD83D\uDC1F'} Ver {totalFish} peces {'\u2192'}
                </button>

                {(() => {
                  const gwId = isGroup ? grp!.id : loc!.id;
                  const gw = GATEWAYS[gwId];
                  return gw ? (
                    <div className="fwm-panel__gw" onClick={() => selectItem(gw.targetId)}>
                      {'\uD83D\uDD2E'} Gateway to {gw.target} ({gw.fish} fish)
                    </div>
                  ) : null;
                })()}

                {isGroup && childLocs.length > 1 && (
                  <div className="fwm-panel__subs">
                    <div className="fwm-panel__slbl">Sub-locations</div>
                    {childLocs.map(cl => (
                      <div key={cl.id}
                        className={`fwm-panel__si${selectedId === cl.id ? ' fwm-panel__si--on' : ''}`}
                        onClick={() => setSelectedId(cl.id)}>
                        {cl.imagePath
                          ? <img src={cl.imagePath} alt="" className="fwm-panel__simg" loading="lazy"/>
                          : <span className="fwm-panel__sid"/>
                        }
                        <div className="fwm-panel__stx">
                          <span>{cl.name}</span>
                          {cl.coords && <span className="fwm-panel__sxy">X:{cl.coords.x} Z:{cl.coords.z}</span>}
                        </div>
                        <span className="fwm-panel__sic">{cl.fishCount} fish</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="fwm-panel__fl">
                  <div className="fwm-panel__fll">Fish ({panelData.fish.length})</div>
                  {panelData.fish.length === 0 && <p className="fwm-panel__emp">No fish data available</p>}
                  {panelData.fish.map((f, i) => {
                    const id = f.id || slug(f.name);
                    return (
                      <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${id}/`} className="fwm-panel__fi">
                        <div className="fwm-panel__fimg" style={rarBg(f.rarity)}>
                          <img src={`/images/fish/${id}.png`} alt={f.name} loading="lazy"/>
                        </div>
                        <span className="fwm-panel__fn">{f.name}</span>
                        <span className="fwm-panel__fr" style={rarBadge(f.rarity)}>{f.rarity}</span>
                      </a>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Events */}
      {eventLocs.length > 0 && (
        <div className="fwm-ev">
          <div className="fwm-ev__lbl">⚡ Event Locations</div>
          <div className="fwm-ev__row">
            {eventLocs.map(loc => (
              <div key={loc.id} className="fwm-ec" onClick={() => setSelectedId(loc.id)}>
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
