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

/* ---- SVG island drawing (anime hand-drawn style) ---- */

/* Rocky island base path — irregular organic shape */
function rockyPath(name: string, cx: number, cy: number, w: number, h: number): string {
  const r = rng(hashStr(name + 'rock'));
  const n = 14 + Math.floor(r() * 4); // 14-17 points
  const pts: [number,number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = w / 2, ry = h / 2;
    // More noise at top, flatter at bottom (like a rock sitting in water)
    const topBias = Math.sin(a) < 0 ? 0.15 : 0.05;
    const noise = 0.82 + r() * 0.36 + (Math.sin(a) < -0.3 ? r() * topBias : 0);
    pts.push([cx + Math.cos(a) * rx * noise, cy + Math.sin(a) * ry * noise]);
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
    d += ` C${(p1[0]+(p2[0]-p0[0])/6).toFixed(1)},${(p1[1]+(p2[1]-p0[1])/6).toFixed(1)} ${(p2[0]-(p3[0]-p1[0])/6).toFixed(1)},${(p2[1]-(p3[1]-p1[1])/6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d + 'Z';
}

/* Generate decoration elements (trees, snow, lava, etc.) based on biome */
function biomeDecorations(name: string, cx: number, cy: number, w: number, h: number, biome: string): React.ReactElement[] {
  const r = rng(hashStr(name + 'deco'));
  const els: React.ReactElement[] = [];
  const hw = w * 0.35, hh = h * 0.3;

  if (biome === 'tropical' || biome === 'swamp') {
    // Palm trees / round trees
    const count = 3 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const tx = cx + (r() - 0.5) * hw * 2;
      const ty = cy - hh * 0.3 + (r() - 0.5) * hh;
      const th = 8 + r() * 6;
      const treeColor = biome === 'swamp' ? '#2d5016' : '#15803d';
      const trunkColor = biome === 'swamp' ? '#4a3520' : '#78350f';
      els.push(
        <g key={`t${i}`}>
          <line x1={tx} y1={ty} x2={tx} y2={ty - th} stroke={trunkColor} strokeWidth="1.5" strokeLinecap="round"/>
          <ellipse cx={tx} cy={ty - th - 3} rx={4 + r() * 3} ry={3 + r() * 2} fill={treeColor} opacity="0.9"/>
          <ellipse cx={tx + 1} cy={ty - th - 5} rx={3 + r() * 2} ry={2.5 + r() * 1.5} fill={biome === 'swamp' ? '#3f6212' : '#22c55e'} opacity="0.7"/>
        </g>
      );
    }
    if (biome === 'swamp') {
      // Mushrooms
      for (let i = 0; i < 2; i++) {
        const mx = cx + (r() - 0.5) * hw;
        const my = cy - r() * hh * 0.5;
        els.push(
          <g key={`m${i}`}>
            <line x1={mx} y1={my} x2={mx} y2={my - 4} stroke="#d4d4d4" strokeWidth="1"/>
            <ellipse cx={mx} cy={my - 5} rx={3} ry={2} fill="#dc2626" opacity="0.8"/>
            <circle cx={mx - 1} cy={my - 5.5} r={0.6} fill="#fff" opacity="0.7"/>
          </g>
        );
      }
    }
  } else if (biome === 'volcanic') {
    // Volcano peak + lava glow
    const vx = cx, vy = cy - hh * 0.6;
    els.push(
      <g key="volcano">
        <polygon points={`${vx},${vy - 10} ${vx - 8},${vy + 4} ${vx + 8},${vy + 4}`} fill="#44403c" opacity="0.9"/>
        <polygon points={`${vx},${vy - 7} ${vx - 4},${vy + 1} ${vx + 4},${vy + 1}`} fill="#dc2626" opacity="0.6"/>
        <ellipse cx={vx} cy={vy - 9} rx={3} ry={1.5} fill="#f97316" opacity="0.8"/>
        <circle cx={vx} cy={vy - 11} r={2} fill="#fbbf24" opacity="0.4"/>
      </g>
    );
    // Rocks
    for (let i = 0; i < 2; i++) {
      const rx2 = cx + (r() - 0.5) * hw * 1.2;
      const ry2 = cy - r() * hh * 0.3;
      els.push(<ellipse key={`vr${i}`} cx={rx2} cy={ry2} rx={3+r()*2} ry={2+r()} fill="#57534e" opacity="0.6"/>);
    }
  } else if (biome === 'snow') {
    // Snow cap + ice crystals + evergreen trees
    els.push(
      <ellipse key="snowcap" cx={cx} cy={cy - hh * 0.5} rx={hw * 0.8} ry={hh * 0.4} fill="#e2e8f0" opacity="0.5"/>
    );
    const count = 2 + Math.floor(r() * 2);
    for (let i = 0; i < count; i++) {
      const tx = cx + (r() - 0.5) * hw * 1.5;
      const ty = cy - hh * 0.2 + (r() - 0.5) * hh * 0.5;
      const th = 7 + r() * 4;
      // Triangular evergreen
      els.push(
        <g key={`st${i}`}>
          <polygon points={`${tx},${ty - th} ${tx - 4},${ty} ${tx + 4},${ty}`} fill="#1e3a2f" opacity="0.8"/>
          <polygon points={`${tx},${ty - th + 2} ${tx - 3},${ty - 2} ${tx + 3},${ty - 2}`} fill="#e2e8f0" opacity="0.4"/>
        </g>
      );
    }
    // Snowflake dots
    for (let i = 0; i < 3; i++) {
      const sx = cx + (r() - 0.5) * hw;
      const sy = cy - hh * 0.6 - r() * 5;
      els.push(<circle key={`sf${i}`} cx={sx} cy={sy} r={1} fill="#fff" opacity="0.5"/>);
    }
  } else if (biome === 'sand') {
    // Sandy dunes + palm + ruins
    els.push(
      <ellipse key="dune" cx={cx + hw * 0.3} cy={cy - hh * 0.1} rx={hw * 0.5} ry={hh * 0.15} fill="#d97706" opacity="0.25"/>
    );
    // A palm tree
    const px = cx - hw * 0.4, py = cy - hh * 0.4;
    els.push(
      <g key="palm">
        <path d={`M${px},${py} Q${px + 2},${py - 8} ${px + 1},${py - 12}`} fill="none" stroke="#78350f" strokeWidth="1.5" strokeLinecap="round"/>
        <ellipse cx={px + 1} cy={py - 14} rx={5} ry={3} fill="#15803d" opacity="0.8"/>
        <ellipse cx={px + 3} cy={py - 13} rx={4} ry={2.5} fill="#22c55e" opacity="0.6"/>
      </g>
    );
    // Stone ruins
    const sx = cx + hw * 0.3, sy = cy - hh * 0.3;
    els.push(
      <g key="ruins">
        <rect x={sx - 3} y={sy - 5} width={2} height={5} fill="#78716c" opacity="0.6" rx="0.5"/>
        <rect x={sx + 1} y={sy - 4} width={2} height={4} fill="#78716c" opacity="0.5" rx="0.5"/>
      </g>
    );
  } else if (biome === 'dark') {
    // Dark crystals + eerie glow
    for (let i = 0; i < 3; i++) {
      const dx = cx + (r() - 0.5) * hw * 1.2;
      const dy = cy - hh * 0.3 + (r() - 0.5) * hh * 0.5;
      const ch = 5 + r() * 5;
      const tilt = (r() - 0.5) * 15;
      els.push(
        <g key={`cr${i}`} transform={`rotate(${tilt},${dx},${dy})`}>
          <polygon points={`${dx},${dy - ch} ${dx - 2},${dy} ${dx + 2},${dy}`} fill="#7c3aed" opacity="0.7"/>
          <polygon points={`${dx},${dy - ch + 1} ${dx - 1},${dy - 1} ${dx + 1},${dy - 1}`} fill="#a78bfa" opacity="0.4"/>
        </g>
      );
    }
    // Eerie glow
    els.push(<circle key="glow" cx={cx} cy={cy - hh * 0.3} r={hw * 0.4} fill="#7c3aed" opacity="0.08"/>);
  } else if (biome === 'ocean') {
    // Waves + buoy
    for (let i = 0; i < 2; i++) {
      const wy = cy - hh * 0.1 + i * 5;
      els.push(
        <path key={`ow${i}`}
          d={`M${cx - hw * 0.6},${wy} Q${cx - hw * 0.2},${wy - 3} ${cx},${wy} T${cx + hw * 0.6},${wy}`}
          fill="none" stroke="#38bdf8" strokeWidth="1" opacity="0.3" strokeLinecap="round"/>
      );
    }
    // Buoy
    els.push(
      <g key="buoy">
        <line x1={cx} y1={cy - hh * 0.5} x2={cx} y2={cy - hh * 0.5 - 6} stroke="#dc2626" strokeWidth="1.5"/>
        <circle cx={cx} cy={cy - hh * 0.5 - 7} r={2} fill="#dc2626" opacity="0.8"/>
      </g>
    );
  } else if (biome === 'mystic') {
    // Floating runes + portal glow
    for (let i = 0; i < 3; i++) {
      const rx2 = cx + (r() - 0.5) * hw;
      const ry2 = cy - hh * 0.5 - r() * 6;
      els.push(<circle key={`rune${i}`} cx={rx2} cy={ry2} r={1.5 + r()} fill="#c084fc" opacity={0.3 + r() * 0.3}/>);
    }
    els.push(<ellipse key="portal" cx={cx} cy={cy - hh * 0.3} rx={5} ry={7} fill="none" stroke="#a855f7" strokeWidth="1" opacity="0.3"/>);
    els.push(<circle key="pglow" cx={cx} cy={cy - hh * 0.3} r={hw * 0.3} fill="#9333ea" opacity="0.1"/>);
  }

  return els;
}

/* Water ripples around island base */
function waterRipples(name: string, cx: number, cy: number, w: number, h: number): React.ReactElement[] {
  const r = rng(hashStr(name + 'rip'));
  const els: React.ReactElement[] = [];
  for (let i = 0; i < 3; i++) {
    const off = 3 + i * 3;
    const rw = w * 0.5 + off * 2 + r() * 4;
    const ry = h * 0.15 + off + r() * 2;
    els.push(
      <ellipse key={`rip${i}`} cx={cx + (r() - 0.5) * 4} cy={cy + h * 0.25 + off}
        rx={rw} ry={ry} fill="none" stroke="rgba(255,255,255,0.06)"
        strokeWidth={1 - i * 0.2} strokeDasharray={i === 2 ? '3,4' : 'none'}/>
    );
  }
  return els;
}

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
};

/* ---- Island groups (SVG coordinates on 1000x600 canvas) ---- */
interface IslandGroup {
  id: string; name: string; icon: string; biome: string;
  children: string[]; x: number; y: number; sz: number;
  sea: 'first'|'second'|'deep';
}
const GROUPS: IslandGroup[] = [
  { id:'sunstone-island', name:'Sunstone Island', icon:'☀️', biome:'sand', children:['sunstone-island','desolate-deep'], x:110, y:85, sz:1.1, sea:'first' },
  { id:'northern-caves', name:'Northern Caves', icon:'🦇', biome:'dark', children:['crimson-cavern','luminescent-cavern','lost-jungle','the-chasm','ancient-archives'], x:310, y:55, sz:1.2, sea:'deep' },
  { id:'castaway-cliffs', name:'Castaway Cliffs', icon:'🪨', biome:'tropical', children:['castaway-cliffs'], x:490, y:42, sz:0.8, sea:'first' },
  { id:'emberreach', name:'Emberreach', icon:'🔥', biome:'volcanic', children:['emberreach'], x:635, y:65, sz:0.9, sea:'first' },
  { id:'ancient-isle', name:'Ancient Isle', icon:'🏛️', biome:'sand', children:['ancient-isle'], x:820, y:80, sz:1.2, sea:'first' },
  { id:'keepers-altar', name:"Keeper's Altar", icon:'⛩️', biome:'mystic', children:['keepers-altar'], x:230, y:160, sz:0.85, sea:'first' },
  { id:'the-ocean', name:'The Ocean', icon:'🌊', biome:'ocean', children:['the-ocean','ocean','open-ocean','ethereal-abyss-pool','salty-reef'], x:380, y:175, sz:1.3, sea:'first' },
  { id:'roslit-bay', name:'Roslit Bay', icon:'🌋', biome:'volcanic', children:['roslit-bay','roslit-volcano','volcanic-vents','marianas-veil-volcanic-vents','brine-pool'], x:60, y:245, sz:1.4, sea:'first' },
  { id:'moosewood', name:'Moosewood', icon:'🏠', biome:'tropical', children:['moosewood','executive-lake','isle-of-new-beginnings'], x:440, y:250, sz:1.3, sea:'first' },
  { id:'lushgrove', name:'Lushgrove', icon:'🌿', biome:'tropical', children:['lushgrove'], x:580, y:185, sz:0.75, sea:'first' },
  { id:'mushgrove-swamp', name:'Mushgrove Swamp', icon:'🍄', biome:'swamp', children:['mushgrove-swamp'], x:720, y:200, sz:1.0, sea:'first' },
  { id:'cursed-isle', name:'Cursed Isle', icon:'💀', biome:'dark', children:['cursed-isle','cults-curse','crypt','frightful-pool','cultist-lair'], x:870, y:235, sz:1.1, sea:'first' },
  { id:'forsaken-shores', name:'Forsaken Shores', icon:'🏝️', biome:'sand', children:['forsaken-shores','grand-reef','atlantis','veil-of-the-forsaken'], x:80, y:390, sz:1.3, sea:'first' },
  { id:'deep-trenches', name:'Deep Trenches', icon:'🕳️', biome:'dark', children:['mariana-trench','abyssal-zenith','marianas-veil-abyssal-zenith','calm-zone','marianas-veil-calm-zone','oceanic-trench','monster-trench','challengers-deep','sunken-depths-pool','atlantis-kraken-pool','poseidon-trial-pool','atlantean-storm','kraken-pool'], x:220, y:355, sz:1.0, sea:'deep' },
  { id:'vertigo', name:'Vertigo', icon:'🌀', biome:'dark', children:['vertigo','the-depths'], x:340, y:370, sz:0.85, sea:'first' },
  { id:'terrapin-island', name:'Terrapin Island', icon:'🐢', biome:'tropical', children:['terrapin-island','pine-shoals','carrot-garden'], x:500, y:380, sz:1.0, sea:'first' },
  { id:'azure-lagoon', name:'Azure Lagoon', icon:'💎', biome:'ocean', children:['azure-lagoon'], x:640, y:345, sz:0.8, sea:'first' },
  { id:'snowcap-island', name:'Snowcap Island', icon:'❄️', biome:'snow', children:['snowcap-island','snowburrow','glacial-grotto','frigid-cavern','cryogenic-canal','crystal-cove'], x:780, y:370, sz:1.3, sea:'first' },
  { id:'waveborne', name:'Waveborne', icon:'⛵', biome:'mystic', children:['waveborne','second-sea','second-sea-waveborne','second-sea-azure-lagoon'], x:380, y:505, sz:1.1, sea:'second' },
  { id:'treasure-island', name:'Treasure Island', icon:'💰', biome:'sand', children:['treasure-island'], x:620, y:510, sz:0.9, sea:'second' },
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

  /* Selected group (or virtual for events) */
  const selGrp = useMemo(() => {
    if (!selGrpId) return null;
    const g = groups.find(g => g.id === selGrpId);
    if (g) return g;
    const loc = locMap.get(selGrpId);
    if (!loc) return null;
    return {
      id: loc.id, name: loc.name, icon: EVT_ICO[loc.id]||'📍',
      biome: 'dark', children: [loc.id], x: 0, y: 0, sz: 1,
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

        {/* LEVEL 1: WORLD MAP (anime-illustrated SVG) */}
        <div className={`fwm-world${level!==1?' fwm-world--out':''}`}>
          <svg className="fwm-svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
            <defs>
              {/* Shadow filter for islands */}
              <filter id="isle-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.5"/>
              </filter>
              {/* Glow for hover */}
              <filter id="isle-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#22d3ee" floodOpacity="0.5"/>
              </filter>
              {/* Dark highlight on rock top */}
              <linearGradient id="rock-hi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.12)"/>
                <stop offset="40%" stopColor="rgba(255,255,255,0)"/>
                <stop offset="100%" stopColor="rgba(0,0,0,0.15)"/>
              </linearGradient>
            </defs>

            {/* Grid lines */}
            <g opacity="0.035">
              {Array.from({length: 13}, (_, i) => <line key={`gv${i}`} x1={i*80} y1="0" x2={i*80} y2="600" stroke="#fff" strokeWidth="0.5"/>)}
              {Array.from({length: 8}, (_, i) => <line key={`gh${i}`} x1="0" y1={i*80} x2="1000" y2={i*80} stroke="#fff" strokeWidth="0.5"/>)}
            </g>

            {/* Ocean waves */}
            {[100, 180, 280, 360, 440, 530].map((y, i) => (
              <path key={`w${i}`}
                d={`M-20,${y} Q${140+i*18},${y-10-i*1.5} ${290+i*8},${y} T${610-i*8},${y} T${960+i*4},${y}`}
                fill="none" stroke={`rgba(255,255,255,${0.045 - i*0.005})`}
                strokeWidth={1.5 - i*0.15} strokeLinecap="round"/>
            ))}

            {/* Sea labels */}
            <text x="500" y="30" textAnchor="middle" fill="#7dd3fc" fontSize="11" fontWeight="800"
              letterSpacing="5" opacity="0.15" fontFamily="inherit">— FIRST SEA —</text>
            <text x="500" y="555" textAnchor="middle" fill="#c4b5fd" fontSize="11" fontWeight="800"
              letterSpacing="5" opacity="0.15" fontFamily="inherit">— SECOND SEA —</text>

            {/* Compass rose */}
            <g transform="translate(955, 35)">
              <circle r="22" fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8"/>
              <circle r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4"/>
              <line x1="0" y1="-20" x2="0" y2="20" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4"/>
              <line x1="-20" y1="0" x2="20" y2="0" stroke="rgba(255,255,255,0.06)" strokeWidth="0.4"/>
              <polygon points="0,-19 2.5,-6 0,-9 -2.5,-6" fill="#ef4444" opacity="0.9"/>
              <polygon points="0,19 2.5,6 0,9 -2.5,6" fill="rgba(255,255,255,0.25)"/>
              <polygon points="-19,0 -6,-2.5 -9,0 -6,2.5" fill="rgba(255,255,255,0.2)"/>
              <polygon points="19,0 6,-2.5 9,0 6,2.5" fill="rgba(255,255,255,0.2)"/>
              <text y="-11" textAnchor="middle" fill="#ef4444" fontSize="6" fontWeight="700" fontFamily="inherit">N</text>
              <text y="16" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="5" fontWeight="600" fontFamily="inherit">S</text>
              <text x="-13" y="2" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="5" fontWeight="600" fontFamily="inherit">W</text>
              <text x="13" y="2" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="5" fontWeight="600" fontFamily="inherit">E</text>
            </g>

            {/* ===== ISLANDS ===== */}
            {groups.map(g => {
              const vis = visIds.has(g.id);
              const b = BIOME[g.biome] || BIOME.ocean;
              const baseW = 55 * g.sz, baseH = 35 * g.sz;
              return (
                <g key={g.id} className="fwm-ig" opacity={vis ? 1 : 0.15}
                  onClick={() => vis && enter(g.id)} style={{ cursor: vis ? 'pointer' : 'default' }}>
                  {/* Water ripples */}
                  {waterRipples(g.name, g.x, g.y, baseW, baseH)}
                  {/* Rock base */}
                  <path d={rockyPath(g.name, g.x, g.y, baseW, baseH)}
                    fill={b.fill} stroke={b.stroke} strokeWidth="1.2" filter="url(#isle-shadow)" opacity="0.95"/>
                  {/* Rock highlight overlay */}
                  <path d={rockyPath(g.name, g.x, g.y, baseW, baseH)}
                    fill="url(#rock-hi)" stroke="none"/>
                  {/* Darker rock edge (inner shape) */}
                  <path d={rockyPath(g.name + 'inner', g.x, g.y + baseH * 0.08, baseW * 0.75, baseH * 0.6)}
                    fill={b.fill} stroke="none" opacity="0.4"/>
                  {/* Biome decorations */}
                  {biomeDecorations(g.name, g.x, g.y, baseW, baseH, g.biome)}
                  {/* Island name */}
                  <text x={g.x} y={g.y + baseH * 0.5 + 14} textAnchor="middle"
                    fill={b.stroke} fontSize="9" fontWeight="700" fontFamily="inherit"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' } as any}>
                    {g.name}
                  </text>
                  {/* Fish count badge */}
                  {g.totalFish > 0 && (<>
                    <rect x={g.x - 16} y={g.y + baseH * 0.5 + 17} width={32} height={11}
                      rx="5" fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
                    <text x={g.x} y={g.y + baseH * 0.5 + 25} textAnchor="middle"
                      fill="#e2e8f0" fontSize="7" fontWeight="700" fontFamily="inherit">
                      {g.totalFish} fish
                    </text>
                  </>)}
                  {/* Coordinates */}
                  {g.coords && (
                    <text x={g.x} y={g.y + baseH * 0.5 + 35} textAnchor="middle"
                      fill="rgba(255,255,255,0.3)" fontSize="6" fontWeight="600"
                      fontFamily="monospace">
                      {g.coords.x}, {g.coords.z}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
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
