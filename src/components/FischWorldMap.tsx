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
  'Divine Secret':17,'Gemstone':16,'Fragment':15,'Relic':14,'Apex':13,
  'Special':12,'Limited':11,'Extinct':10,'Secret':9,'Exotic':8,
  'Mythical':7,'Legendary':6,'Rare':5,'Unusual':4,'Uncommon':3,'Common':2,'Trash':1,
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

const GROUPS: IslandGroup[] = [
  { id:'moosewood', name:'Moosewood', icon:'🏠', children:['moosewood','executive-lake','isle-of-new-beginnings'], gps:{x:400,z:250}, type:'island', sea:'first' },
  { id:'roslit-bay', name:'Roslit Bay', icon:'🌋', children:['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], gps:{x:-1600,z:500}, type:'island', sea:'first' },
  { id:'snowcap-island', name:'Snowcap Island', icon:'❄️', children:['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], gps:{x:2625,z:2370}, type:'island', sea:'first' },
  { id:'terrapin-island', name:'Terrapin Island', icon:'🐢', children:['terrapin-island','pine-shoals','carrot-garden'], gps:{x:-96,z:1872}, type:'island', sea:'first' },
  { id:'forsaken-shores', name:'Forsaken Shores', icon:'🏝️', children:['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], gps:{x:-2750,z:1450}, type:'island', sea:'first' },
  { id:'cursed-isle', name:'Cursed Isle', icon:'💀', children:['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], gps:{x:1800,z:1210}, type:'island', sea:'first' },
  { id:'sunstone-island', name:'Sunstone Island', icon:'☀️', children:['sunstone-island','desolate-deep'], gps:{x:-870,z:-1100}, type:'island', sea:'first' },
  { id:'ancient-isle', name:'Ancient Isle', icon:'🏛️', children:['ancient-isle'], gps:{x:6000,z:300}, type:'island', sea:'first' },
  { id:'mushgrove-swamp', name:'Mushgrove Swamp', icon:'🍄', children:['mushgrove-swamp'], gps:{x:2420,z:-270}, type:'island', sea:'first' },
  { id:'lushgrove', name:'Lushgrove', icon:'🌿', children:['lushgrove'], gps:{x:1132,z:-388}, type:'island', sea:'first' },
  { id:'emberreach', name:'Emberreach', icon:'🔥', children:['emberreach'], gps:{x:2300,z:-800}, type:'island', sea:'first' },
  { id:'northern-caves', name:'Northern Caves', icon:'🦇', children:['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], gps:{x:-1750,z:-1500}, type:'island', sea:'deep' },
  { id:'birch-cay', name:'Birch Cay', icon:'🌲', children:['birch-cay'], gps:{x:1448,z:-2351}, type:'island', sea:'first' },
  { id:'earmark-island', name:'Earmark Island', icon:'🏷️', children:['earmark-island'], gps:{x:1195,z:971}, type:'island', sea:'first' },
  { id:'castaway-cliffs', name:'Castaway Cliffs', icon:'🪨', children:['castaway-cliffs'], gps:{x:690,z:-1693}, type:'island', sea:'first' },
  { id:'harvesters-spike', name:"Harvester's Spike", icon:'⛏️', children:['harvesters-spike'], gps:{x:-1463,z:58}, type:'island', sea:'first' },
  { id:'the-arch', name:'The Arch', icon:'🌉', children:['the-arch'], gps:{x:981,z:-1834}, type:'island', sea:'first' },
  { id:'statue-of-sovereignty', name:'Statue of Sovereignty', icon:'🗽', children:['statue-of-sovereignty'], gps:{x:37,z:-1017}, type:'island', sea:'first' },
  { id:'the-laboratory', name:'The Laboratory', icon:'🔬', children:['the-laboratory'], gps:{x:-400,z:-700}, type:'island', sea:'first' },
  { id:'waveborne', name:'Waveborne', icon:'⛵', children:['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], gps:{x:2000,z:3500}, type:'island', sea:'second' },
  { id:'treasure-island', name:'Treasure Island', icon:'💰', children:['treasure-island'], gps:{x:3500,z:3700}, type:'island', sea:'second' },
  // Special zones
  { id:'the-ocean', name:'The Ocean', icon:'🌊', children:['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], gps:{x:200,z:-200}, type:'special', sea:'first' },
  { id:'deep-trenches', name:'Deep Trenches', icon:'🔱', children:['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], gps:{x:-2200,z:900}, type:'special', sea:'deep' },
  { id:'vertigo', name:'Vertigo', icon:'🌀', label:'Random loc', children:['vertigo','the-depths'], gps:{x:3000,z:2500}, type:'special', sea:'first' },
  { id:'azure-lagoon', name:'Azure Lagoon', icon:'💧', children:['azure-lagoon'], gps:{x:1500,z:1100}, type:'special', sea:'first' },
  { id:'keepers-altar', name:"Keeper's Altar", icon:'⛩️', label:'Under Statue', children:['keepers-altar'], gps:{x:100,z:-1100}, type:'special', sea:'first' },
];

/* ---- Island button positions (CSS %) ----
   Derived from crop-islands.py bounding boxes on the 5504x3072 map.
   left/top = top-left corner of the crop rectangle as % of map.
   w = crop width as % of map width. No translate(-50%,-50%) — exact overlay. */
const ISLAND_POS: Record<string, { left: string; top: string; w: string }> = {
  'northern-caves':        { left: '4.72%',  top: '0%',      w: '14.53%' },
  'sunstone-island':       { left: '12.19%', top: '9.86%',   w: '11.63%' },
  'statue-of-sovereignty': { left: '34.74%', top: '14%',     w: '6.54%' },
  'the-laboratory':        { left: '29.72%', top: '21.81%',  w: '6.54%' },
  'the-arch':              { left: '48%',    top: '14.84%',  w: '7.99%' },
  'birch-cay':             { left: '53.27%', top: '4.85%',   w: '9.45%' },
  'mushgrove-swamp':       { left: '67.82%', top: '0%',      w: '20.35%' },
  'harvesters-spike':      { left: '18.19%', top: '35.87%',  w: '7.63%' },
  'roslit-bay':            { left: '7.65%',  top: '30.27%',  w: '16.72%' },
  'moosewood':             { left: '31.10%', top: '28.32%',  w: '21.80%' },
  'lushgrove':             { left: '50.18%', top: '19.21%',  w: '11.63%' },
  'earmark-island':        { left: '52.36%', top: '42.81%',  w: '7.27%' },
  'cursed-isle':           { left: '58.19%', top: '38.28%',  w: '15.62%' },
  'forsaken-shores':       { left: '2.36%',  top: '51.01%',  w: '19.26%' },
  'terrapin-island':       { left: '27.11%', top: '53.68%',  w: '21.80%' },
  'snowcap-island':        { left: '64.46%', top: '50.03%',  w: '21.08%' },
  'ancient-isle':          { left: '88.46%', top: '21.97%',  w: '11.54%' },
  /* Islands not on the painted map — manual positions */
  'castaway-cliffs':       { left: '46%',    top: '15%',     w: '5%' },
  'emberreach':            { left: '66%',    top: '18%',     w: '5%' },
  'waveborne':             { left: '40%',    top: '88%',     w: '6%' },
  'treasure-island':       { left: '58%',    top: '90%',     w: '5%' },
};

/* Special zone positions */
const SPECIAL_POS: Record<string, { left: string; top: string }> = {
  'the-ocean':      { left: '36%', top: '36%' },
  'deep-trenches':  { left: '6%', top: '55%' },
  'azure-lagoon':   { left: '60%', top: '54%' },
  'keepers-altar':  { left: '40%', top: '20%' },
  'vertigo':        { left: '82%', top: '72%' },
};

/* Islands that use wiki images instead of cropped map images */
const WIKI_FALLBACK = new Set(['castaway-cliffs', 'emberreach', 'waveborne', 'treasure-island']);

function getIslandImg(id: string): string {
  return WIKI_FALLBACK.has(id)
    ? `/images/locations/${id}.png`
    : `/images/map/islands/${id}.png`;
}

/* GPS → map position for "Where Am I?" */
function gpsToPosition(gpsX: number, gpsZ: number) {
  const normX = (gpsX + 2800) / 5600;
  const normZ = (gpsZ + 2500) / 5000;
  return { left: (5 + normX * 90) + '%', top: (5 + normZ * 75) + '%' };
}

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
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [whereX, setWhereX] = useState('');
  const [whereY, setWhereY] = useState('');
  const [whereZ, setWhereZ] = useState('');
  const [marker, setMarker] = useState<{ left: string; top: string; nearest: string; dist: number } | null>(null);
  const [whereOpen, setWhereOpen] = useState(false);

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
    setSelectedId(prev => prev === id ? null : id);
  }, []);
  const closePanel = useCallback(() => setSelectedId(null), []);

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

  /* Where Am I */
  const findMe = useCallback(() => {
    const x = parseFloat(whereX), z = parseFloat(whereZ);
    if (isNaN(x) || isNaN(z)) return;
    const pos = gpsToPosition(x, z);
    let nearest = '', minDist = Infinity;
    for (const g of GROUPS) {
      const dx = g.gps.x - x, dz = g.gps.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) { minDist = dist; nearest = g.name; }
    }
    setMarker({ ...pos, nearest, dist: Math.round(minDist) });
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

      {/* ===== MAP FRAME ===== */}
      <div className="fwm-frame" onClick={closePanel}>

        {/* Island buttons */}
        {groups.filter(g => g.type === 'island' && ISLAND_POS[g.id]).map(g => {
          const pos = ISLAND_POS[g.id];
          const isActive = selectedId === g.id;
          const isVisible = visIds.has(g.id);
          const orbitFish = isActive ? topFish(g.allFish, 10) : [];

          return (
            <button key={g.id} className={`fwm-btn${isActive ? ' fwm-btn--on' : ''}`}
              aria-label={`${g.name} — ${g.totalFish} fish`}
              style={{ left: pos.left, top: pos.top, width: pos.w, opacity: isVisible ? 1 : 0.2 }}
              onClick={e => { e.stopPropagation(); selectItem(g.id); }}>
              <img src={getIslandImg(g.id)} alt={g.name} className="fwm-btn__img" loading="lazy" />
              <span className="fwm-btn__n">{g.name}</span>
              {g.totalFish > 0 && <span className="fwm-btn__f">{g.totalFish} fish</span>}

              {/* Fish orbit */}
              {orbitFish.length > 0 && (
                <div className="fwm-orbit">
                  {orbitFish.map((f, i) => {
                    const deg = Math.round((360 / orbitFish.length) * i - 90);
                    const fid = f.id || slug(f.name);
                    const rc = RAR_CLR[f.rarity] || '#aaa';
                    return (
                      <a key={fid + i} href={`/games/${gameSlug}/fish/${fid}/`}
                        className="fwm-fdot" title={`${f.name} (${f.rarity})`}
                        onClick={e => e.stopPropagation()}
                        style={{ transform: `rotate(${deg}deg) translateX(70px) rotate(${-deg}deg)`, borderColor: rc }}>
                        <img src={`/images/fish/${fid}.png`} alt={f.name} loading="lazy" />
                        <span className="fwm-fdot__n">{f.name}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}

        {/* Special zones */}
        {groups.filter(g => g.type === 'special' && SPECIAL_POS[g.id]).map(g => {
          const pos = SPECIAL_POS[g.id];
          const isActive = selectedId === g.id;
          const isVisible = visIds.has(g.id);
          return (
            <button key={g.id} className={`fwm-sz${isActive ? ' fwm-sz--on' : ''}`}
              aria-label={`${g.name} — ${g.totalFish} fish`}
              style={{ left: pos.left, top: pos.top, opacity: isVisible ? 1 : 0.2 }}
              onClick={e => { e.stopPropagation(); selectItem(g.id); }}>
              <span className="fwm-sz__i">{g.icon}</span>
              <span className="fwm-sz__n">{g.label || g.name} · {g.totalFish}</span>
            </button>
          );
        })}

        {/* Where Am I marker */}
        {marker && (
          <div className="fwm-marker" style={{ left: marker.left, top: marker.top }}>
            <div className="fwm-marker__dot" />
            <div className="fwm-marker__tip">
              <strong>You are here</strong><br/>
              Nearest: {marker.nearest}<br/>
              ~{marker.dist} studs
            </div>
          </div>
        )}

        {/* ===== INFO PANEL ===== */}
        <div className={`fwm-panel${panelData ? ' fwm-panel--open' : ''}`} onClick={e => e.stopPropagation()}>
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

                {isGroup && childLocs.length > 1 && (
                  <div className="fwm-panel__subs">
                    <div className="fwm-panel__slbl">Sub-locations</div>
                    {childLocs.map(cl => (
                      <div key={cl.id}
                        className={`fwm-panel__si${selectedId === cl.id ? ' fwm-panel__si--on' : ''}`}
                        onClick={() => setSelectedId(cl.id)}>
                        <span className="fwm-panel__sid"/>
                        <span>{cl.name}</span>
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

      {/* Where Am I */}
      <div className={`fwm-where${whereOpen ? ' fwm-where--open' : ''}`}>
        <button className="fwm-where__toggle" onClick={() => setWhereOpen(!whereOpen)}>
          📍 Where Am I?
        </button>
        {whereOpen && (
          <div className="fwm-where__body">
            <div className="fwm-where__row">
              <input type="number" placeholder="X" value={whereX}
                onChange={e => setWhereX(e.target.value)} className="fwm-where__in"
                onKeyDown={e => e.key === 'Enter' && findMe()} />
              <input type="number" placeholder="Y" value={whereY}
                onChange={e => setWhereY(e.target.value)} className="fwm-where__in fwm-where__in--y" />
              <input type="number" placeholder="Z" value={whereZ}
                onChange={e => setWhereZ(e.target.value)} className="fwm-where__in"
                onKeyDown={e => e.key === 'Enter' && findMe()} />
              <button className="fwm-where__btn" onClick={findMe}>Find</button>
            </div>
            {marker && (
              <div className="fwm-where__result">
                Near <strong>{marker.nearest}</strong> (~{marker.dist} studs)
                <button className="fwm-where__clr" onClick={() => setMarker(null)}>✕</button>
              </div>
            )}
          </div>
        )}
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
