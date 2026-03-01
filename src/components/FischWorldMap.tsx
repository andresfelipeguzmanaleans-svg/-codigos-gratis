import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';

/* ================================================================
   FischWorldMap — Leaflet.js CRS.Simple interactive map
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

/* ---- Blob clip-path ---- */
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
  'birch-cay': '/images/locations/birch-cay.png',
  'the-arch': '/images/locations/the-arch.png',
  'earmark-island': '/images/locations/earmark-island.png',
  'harvesters-spike': '/images/locations/harvesters-spike.png',
  'statue-of-sovereignty': '/images/locations/statue-of-sovereignty.png',
  'the-laboratory': '/images/locations/the-laboratory.png',
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

/* Procedural shapes */
function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function rarBg(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `linear-gradient(135deg, ${c}30, ${c}0d)` };
}
function rarBadge(r: string): React.CSSProperties {
  const c = RAR_CLR[r]||'#94a3b8'; return { background: `${c}25`, color: c };
}

/* Biome colors */
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

/* Balloon aerial images */
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

/* ---- GPS → Leaflet LatLng (CRS.Simple) ---- */
// lat = -Z (north=top), lng = X
function gameToLatLng(gps: { x: number; z: number }): L.LatLngExpression {
  return [-gps.z, gps.x];
}

/* ---- Island groups ---- */
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; gps: { x: number; z: number };
  size: 'lg'|'md'|'sm';
  type: 'island'|'special';
  sea: 'first'|'second'|'deep';
  label?: string;
}

const GROUPS: IslandGroup[] = [
  // First Sea — Large
  { id:'moosewood', name:'Moosewood', icon:'🏠', biome:'tropical', children:['moosewood','executive-lake','isle-of-new-beginnings'], gps:{x:400,z:250}, size:'lg', type:'island', sea:'first' },
  { id:'roslit-bay', name:'Roslit Bay', icon:'🌋', biome:'volcanic', children:['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], gps:{x:-1600,z:500}, size:'lg', type:'island', sea:'first' },
  { id:'snowcap-island', name:'Snowcap Island', icon:'❄️', biome:'snow', children:['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], gps:{x:2625,z:2370}, size:'lg', type:'island', sea:'first' },
  { id:'terrapin-island', name:'Terrapin Island', icon:'🐢', biome:'tropical', children:['terrapin-island','pine-shoals','carrot-garden'], gps:{x:-96,z:1872}, size:'lg', type:'island', sea:'first' },
  { id:'forsaken-shores', name:'Forsaken Shores', icon:'🏝️', biome:'sand', children:['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], gps:{x:-2750,z:1450}, size:'lg', type:'island', sea:'first' },
  { id:'cursed-isle', name:'Cursed Isle', icon:'💀', biome:'dark', children:['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], gps:{x:1800,z:1210}, size:'lg', type:'island', sea:'first' },
  // First Sea — Medium
  { id:'sunstone-island', name:'Sunstone Island', icon:'☀️', biome:'sand', children:['sunstone-island','desolate-deep'], gps:{x:-870,z:-1100}, size:'md', type:'island', sea:'first' },
  { id:'ancient-isle', name:'Ancient Isle', icon:'🏛️', biome:'sand', children:['ancient-isle'], gps:{x:6000,z:300}, size:'md', type:'island', sea:'first' },
  { id:'mushgrove-swamp', name:'Mushgrove Swamp', icon:'🍄', biome:'swamp', children:['mushgrove-swamp'], gps:{x:2420,z:-270}, size:'md', type:'island', sea:'first' },
  { id:'lushgrove', name:'Lushgrove', icon:'🌿', biome:'tropical', children:['lushgrove'], gps:{x:1132,z:-388}, size:'md', type:'island', sea:'first' },
  { id:'emberreach', name:'Emberreach', icon:'🔥', biome:'volcanic', children:['emberreach'], gps:{x:2300,z:-800}, size:'md', type:'island', sea:'first' },
  { id:'northern-caves', name:'Northern Caves', icon:'🦇', biome:'dark', children:['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], gps:{x:-1750,z:-1500}, size:'md', type:'island', sea:'deep' },
  // First Sea — Small
  { id:'birch-cay', name:'Birch Cay', icon:'🌲', biome:'tropical', children:['birch-cay'], gps:{x:1448,z:-2351}, size:'sm', type:'island', sea:'first' },
  { id:'earmark-island', name:'Earmark Island', icon:'🏷️', biome:'tropical', children:['earmark-island'], gps:{x:1195,z:971}, size:'sm', type:'island', sea:'first' },
  { id:'castaway-cliffs', name:'Castaway Cliffs', icon:'🪨', biome:'tropical', children:['castaway-cliffs'], gps:{x:690,z:-1693}, size:'sm', type:'island', sea:'first' },
  { id:'harvesters-spike', name:"Harvester's Spike", icon:'⛏️', biome:'sand', children:['harvesters-spike'], gps:{x:-1463,z:58}, size:'sm', type:'island', sea:'first' },
  { id:'the-arch', name:'The Arch', icon:'🌉', biome:'sand', children:['the-arch'], gps:{x:981,z:-1834}, size:'sm', type:'island', sea:'first' },
  { id:'statue-of-sovereignty', name:'Statue of Sovereignty', icon:'🗽', biome:'sand', children:['statue-of-sovereignty'], gps:{x:37,z:-1017}, size:'sm', type:'island', sea:'first' },
  { id:'the-laboratory', name:'The Laboratory', icon:'🔬', biome:'dark', children:['the-laboratory'], gps:{x:-400,z:-700}, size:'sm', type:'island', sea:'first' },
  // Second Sea
  { id:'waveborne', name:'Waveborne', icon:'⛵', biome:'mystic', children:['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], gps:{x:2000,z:3500}, size:'md', type:'island', sea:'second' },
  { id:'treasure-island', name:'Treasure Island', icon:'💰', biome:'sand', children:['treasure-island'], gps:{x:3500,z:3700}, size:'sm', type:'island', sea:'second' },
  // Special Zones
  { id:'the-ocean', name:'The Ocean', icon:'🌊', biome:'ocean', children:['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], gps:{x:200,z:-200}, size:'sm', type:'special', sea:'first' },
  { id:'deep-trenches', name:'Deep Trenches', icon:'🔱', biome:'dark', children:['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], gps:{x:-2200,z:900}, size:'sm', type:'special', sea:'deep' },
  { id:'vertigo', name:'Vertigo', icon:'🌀', biome:'dark', label:'⚡ Random location', children:['vertigo','the-depths'], gps:{x:3000,z:2500}, size:'sm', type:'special', sea:'first' },
  { id:'azure-lagoon', name:'Azure Lagoon', icon:'💧', biome:'ocean', children:['azure-lagoon'], gps:{x:1500,z:1100}, size:'sm', type:'special', sea:'first' },
  { id:'keepers-altar', name:"Keeper's Altar", icon:'⛩️', biome:'mystic', label:'Under Statue', children:['keepers-altar'], gps:{x:100,z:-1100}, size:'sm', type:'special', sea:'first' },
];

const EVENT_IDS = ['admin-events','fischfright-2025','winter-village','lego-event-2025','fischgiving-2025'];
const EVT_ICO: Record<string,string> = {
  'admin-events':'⭐','fischfright-2025':'🎃','winter-village':'🎄','lego-event-2025':'🧱','fischgiving-2025':'🦃',
};

/* Icon size by group size and zoom */
const SIZE_BASE: Record<string, number> = { lg: 48, md: 36, sm: 26 };

function getIconSize(size: 'lg'|'md'|'sm', zoom: number): number {
  const base = SIZE_BASE[size];
  // Scale icon with zoom: at zoom -2 icons are small, at zoom 2 they're large
  const scale = Math.pow(1.4, zoom + 1);
  return Math.round(Math.max(16, Math.min(120, base * scale)));
}

/* Fish to show at a given zoom level */
function getFishForZoom(allFish: FishEntry[], zoom: number): FishEntry[] {
  if (zoom < 0) return [];
  const sorted = [...allFish].sort((a, b) => (RAR_ORD[b.rarity]||0) - (RAR_ORD[a.rarity]||0));
  if (zoom < 1) return sorted.slice(0, 6);
  if (zoom < 2) return sorted.slice(0, 12);
  return sorted;
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

  const eventLocs = useMemo(() =>
    EVENT_IDS.map(id => locMap.get(id)).filter(Boolean) as MapLocation[]
  , [locMap]);

  /* ---- State ---- */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [whereX, setWhereX] = useState('');
  const [whereY, setWhereY] = useState('');
  const [whereZ, setWhereZ] = useState('');
  const [marker, setMarker] = useState<{ nearest: string; dist: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState(-1);
  const [mapActive, setMapActive] = useState(true);

  /* Refs */
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const islandLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const specialLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const fishLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const gridLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const whereMarkerRef = useRef<L.Marker | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

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

  /* ---- Leaflet Map Init ---- */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const isMobile = window.innerWidth < 768;

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      maxBounds: L.latLngBounds([-4200, -3200], [3000, 6500]),
      maxBoundsViscosity: 0.8,
      attributionControl: false,
      zoomControl: false,
      dragging: !isMobile,
      touchZoom: true,
    });

    // Fit to First Sea initially
    map.fitBounds(L.latLngBounds([-2500, -2800], [2500, 2800]));

    // Add zoom control
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Add layers
    islandLayerRef.current.addTo(map);
    specialLayerRef.current.addTo(map);
    gridLayerRef.current.addTo(map);

    // Grid lines
    const gridColor = 'rgba(255,255,255,0.04)';
    const originColor = 'rgba(34,211,238,0.08)';
    for (let x = -3000; x <= 6000; x += 1000) {
      L.polyline([[-4000, x], [3000, x]], {
        color: x === 0 ? originColor : gridColor,
        weight: x === 0 ? 1.5 : 0.5,
        dashArray: x === 0 ? '6,4' : undefined,
        interactive: false,
      }).addTo(gridLayerRef.current);
    }
    for (let z = -3000; z <= 4000; z += 1000) {
      const lat = -z;
      L.polyline([[lat, -3000], [lat, 6000]], {
        color: z === 0 ? originColor : gridColor,
        weight: z === 0 ? 1.5 : 0.5,
        dashArray: z === 0 ? '6,4' : undefined,
        interactive: false,
      }).addTo(gridLayerRef.current);
    }

    // Sea divider at Z ~= 3000
    L.polyline([[- 3000, -3000], [-3000, 6000]], {
      color: 'rgba(196,181,253,0.25)',
      weight: 1,
      dashArray: '8,4',
      interactive: false,
    }).addTo(gridLayerRef.current);

    // Region labels
    const labelIcon = (text: string) => L.divIcon({
      html: `<div class="fwm-region-label">${text}</div>`,
      className: '',
      iconSize: [200, 20],
      iconAnchor: [100, 10],
    });
    L.marker([0, 0] as L.LatLngExpression, { icon: labelIcon('— FIRST SEA —'), interactive: false }).addTo(gridLayerRef.current);
    L.marker([-3400, 2500] as L.LatLngExpression, { icon: labelIcon('— SECOND SEA —'), interactive: false }).addTo(gridLayerRef.current);

    // Track zoom
    map.on('zoomend', () => setCurrentZoom(map.getZoom()));
    setCurrentZoom(map.getZoom());

    // Click on empty map → close panel
    map.on('click', () => setSelectedId(null));

    if (isMobile) {
      setMapActive(false);
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* Mobile tap to interact */
  const activateMap = useCallback(() => {
    setMapActive(true);
    const map = mapRef.current;
    if (map) {
      map.dragging.enable();
    }
  }, []);

  /* ---- Rebuild island & special markers on groups/filter/zoom change ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear and rebuild island markers
    islandLayerRef.current.clearLayers();
    specialLayerRef.current.clearLayers();
    markersRef.current.clear();

    for (const g of groups) {
      const visible = visIds.has(g.id);
      const isSelected = selectedId === g.id;

      if (g.type === 'island') {
        const iconPx = getIconSize(g.size, currentZoom);
        const b = BIOME[g.biome] || BIOME.ocean;
        const imgSrc = ISLE_IMG[g.id] || g.imagePath || '';
        const clipD = blobClipPath(g.name);

        const html = `
          <div class="fwm-isle${isSelected ? ' fwm-isle--sel' : ''}" style="width:${iconPx}px;">
            <svg class="fwm-isle__svg" viewBox="-10 -10 120 120" style="width:${iconPx}px;height:${iconPx}px;">
              <defs><clipPath id="lclip-${g.id}"><path d="${clipD}"/></clipPath></defs>
              <g clip-path="url(#lclip-${g.id})">
                <rect x="-10" y="-10" width="120" height="120" fill="${b.fill}"/>
                ${imgSrc ? `<image href="${imgSrc}" x="-20" y="-20" width="140" height="140" preserveAspectRatio="xMidYMid slice"/>` : ''}
                <rect x="-10" y="-10" width="120" height="120" fill="${b.fill}" opacity="0.2"/>
              </g>
            </svg>
            <span class="fwm-isle__n">${g.name}</span>
            ${g.totalFish > 0 ? `<span class="fwm-isle__f">${g.totalFish} fish</span>` : ''}
          </div>
        `;

        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [iconPx, iconPx + 24],
          iconAnchor: [iconPx / 2, iconPx / 2],
        });

        const m = L.marker(gameToLatLng(g.gps), { icon, opacity: visible ? 1 : 0.15 });
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectItem(g.id);
        });
        m.addTo(islandLayerRef.current);
        markersRef.current.set(g.id, m);
      } else {
        // Special zone
        const html = `
          <div class="fwm-poi${isSelected ? ' fwm-poi--sel' : ''}">
            <span class="fwm-poi__i">${g.icon}</span>
            <span class="fwm-poi__n">${g.label || g.name} · ${g.totalFish} fish</span>
          </div>
        `;
        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [120, 36],
          iconAnchor: [60, 18],
        });
        const m = L.marker(gameToLatLng(g.gps), { icon, opacity: visible ? 1 : 0.15 });
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          selectItem(g.id);
        });
        m.addTo(specialLayerRef.current);
        markersRef.current.set(g.id, m);
      }
    }
  }, [groups, currentZoom, visIds, selectedId, selectItem]);

  /* ---- Fish orbit markers (zoom-dependent) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    fishLayerRef.current.clearLayers();

    if (currentZoom < 0) return; // no fish at overview zoom

    // Only show fish for islands in current viewport
    const bounds = map.getBounds();

    for (const g of groups) {
      if (!visIds.has(g.id)) continue;
      const latLng = gameToLatLng(g.gps);
      if (!bounds.contains(latLng as L.LatLngExpression)) continue;

      const fishList = getFishForZoom(g.allFish, currentZoom);
      if (fishList.length === 0) continue;

      // Orbit radius in GPS units (fixed, so it grows visually with zoom)
      const orbitR = g.size === 'lg' ? 120 : g.size === 'md' ? 90 : 60;

      fishList.forEach((f, i) => {
        const angle = (i / fishList.length) * Math.PI * 2 - Math.PI / 2;
        const offsetZ = Math.sin(angle) * orbitR; // negative because lat = -Z
        const offsetX = Math.cos(angle) * orbitR;
        const fishLatLng: L.LatLngExpression = [
          -g.gps.z - offsetZ,
          g.gps.x + offsetX,
        ];

        const fid = f.id || slug(f.name);
        const rarColor = RAR_CLR[f.rarity] || '#94a3b8';
        const showName = currentZoom >= 2;
        const dotSize = currentZoom >= 1 ? 24 : 18;

        const html = `
          <a href="/games/${gameSlug}/fish/${fid}/" class="fwm-fdot" title="${f.name} (${f.rarity})"
            style="width:${dotSize}px;height:${dotSize}px;border-color:${rarColor}60;background:linear-gradient(135deg,${rarColor}30,${rarColor}0d);">
            <img src="/images/fish/${fid}.png" alt="${f.name}" loading="lazy"
              style="width:${dotSize - 4}px;height:${dotSize - 4}px;object-fit:contain;"/>
          </a>
          ${showName ? `<span class="fwm-fdot__n">${f.name}</span>` : ''}
        `;

        const icon = L.divIcon({
          html,
          className: '',
          iconSize: [dotSize, showName ? dotSize + 14 : dotSize],
          iconAnchor: [dotSize / 2, dotSize / 2],
        });

        L.marker(fishLatLng, { icon }).addTo(fishLayerRef.current);
      });
    }

    // Also add fish layer to map if not already
    if (!map.hasLayer(fishLayerRef.current)) {
      fishLayerRef.current.addTo(map);
    }
  }, [currentZoom, groups, visIds, gameSlug]);

  /* "Where Am I?" */
  const findMe = useCallback(() => {
    const x = parseFloat(whereX), z = parseFloat(whereZ);
    if (isNaN(x) || isNaN(z)) return;
    const map = mapRef.current;
    if (!map) return;

    const latLng = gameToLatLng({ x, z });

    // Remove previous marker
    if (whereMarkerRef.current) {
      map.removeLayer(whereMarkerRef.current);
    }

    let nearest = '', minDist = Infinity;
    for (const g of GROUPS) {
      const dx = g.gps.x - x, dz = g.gps.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minDist) { minDist = dist; nearest = g.name; }
    }

    const icon = L.divIcon({
      html: `<div class="fwm-marker">
        <div class="fwm-marker__dot"></div>
        <div class="fwm-marker__tip">
          <strong>📍 You are here</strong><br/>
          Nearest: ${nearest}<br/>
          ~${Math.round(minDist)} studs away
        </div>
      </div>`,
      className: '',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const m = L.marker(latLng, { icon, zIndexOffset: 1000 }).addTo(map);
    whereMarkerRef.current = m;
    map.flyTo(latLng as L.LatLngExpression, 1, { duration: 0.8 });
    setMarker({ nearest, dist: Math.round(minDist) });
  }, [whereX, whereZ]);

  /* Escape key → close panel */
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && selectedId) closePanel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [closePanel, selectedId]);

  /* URL params */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const loc = p.get('location') || p.get('loc');
    if (!loc) return;
    const direct = groups.find(g => g.id === loc);
    if (direct) {
      setSelectedId(direct.id);
      const map = mapRef.current;
      if (map) map.flyTo(gameToLatLng(direct.gps) as L.LatLngExpression, 0, { duration: 0.5 });
      return;
    }
    const parent = groups.find(g => g.children.includes(loc));
    if (parent) { setSelectedId(loc); }
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
          {marker && <button className="fwm-where__clr" onClick={() => {
            if (whereMarkerRef.current && mapRef.current) {
              mapRef.current.removeLayer(whereMarkerRef.current);
              whereMarkerRef.current = null;
            }
            setMarker(null);
          }}>✕</button>}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="fwm-bread">
        <span className="fwm-bread__c">🗺️ World Map</span>
      </div>

      {/* ===== MAP FRAME ===== */}
      <div className="fwm-frame">
        <div ref={containerRef} className="fwm-leaflet-container" style={{ width: '100%', height: '100%' }} />

        {/* Mobile: tap to interact overlay */}
        {!mapActive && (
          <div className="fwm-tap-overlay" onClick={activateMap}>
            <span>Tap to interact with map</span>
          </div>
        )}

        {/* ===== INFO PANEL ===== */}
        <div className={`fwm-panel${panelData ? ' fwm-panel--open' : ''}`}>
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
