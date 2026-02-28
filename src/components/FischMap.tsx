import { useState, useMemo, useEffect } from 'react';

// ---- Types ----

interface FishEntry { name: string; rarity: string; id?: string; }

interface MapLocation {
  id: string;
  name: string;
  fishCount: number;
  isPremium: boolean;
  isEvent: boolean;
  isSeasonal: boolean;
  coords: { x: number; z: number } | null;
  imagePath: string | null;
  fish: FishEntry[];
  availableWeathers: string[];
}

interface Props { locations: MapLocation[]; gameSlug: string; }

// ---- Constants ----

const RARITY_ORDER: Record<string, number> = {
  'Divine Secret': 17, 'Gemstone': 16, 'Fragment': 15, 'Relic': 14,
  'Apex': 13, 'Special': 12, 'Limited': 11, 'Extinct': 10,
  'Secret': 9, 'Exotic': 8, 'Mythical': 7, 'Legendary': 6,
  'Rare': 5, 'Unusual': 4, 'Uncommon': 3, 'Common': 2, 'Trash': 1,
};

const RARITY_COLORS: Record<string, string> = {
  'Trash': '#808080', 'Common': '#B0B0B0', 'Uncommon': '#2ECC71', 'Unusual': '#A3D977',
  'Rare': '#3498DB', 'Legendary': '#F39C12', 'Mythical': '#9B59B6', 'Exotic': '#E74C3C',
  'Secret': '#1ABC9C', 'Relic': '#CD7F32', 'Fragment': '#E056A0', 'Gemstone': '#00FFFF',
  'Extinct': '#5D6D7E', 'Limited': '#FFD700', 'Apex': '#FF4500', 'Special': '#FF69B4',
  'Divine Secret': '#FFE066',
};

function slugify(name: string) {
  return name.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getHighestRarity(fish: FishEntry[]): string {
  if (!fish.length) return 'Common';
  let best = 'Common', bestOrder = 0;
  for (const f of fish) {
    const o = RARITY_ORDER[f.rarity] || 0;
    if (o > bestOrder) { bestOrder = o; best = f.rarity; }
  }
  return best;
}

// ---- Collision avoidance: spread overlapping nodes ----

interface LayoutNode { id: string; x: number; y: number; }

function resolveCollisions(nodes: LayoutNode[], minDist: number, iterations = 40): LayoutNode[] {
  const out = nodes.map(n => ({ ...n }));
  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist && d > 0.01) {
          const push = (minDist - d) / 2 + 0.5;
          const nx = dx / d, ny = dy / d;
          out[i].x -= nx * push; out[i].y -= ny * push;
          out[j].x += nx * push; out[j].y += ny * push;
          moved = true;
        } else if (d < 0.01) {
          // Exactly same spot — push random direction
          out[j].x += (Math.random() - 0.5) * minDist;
          out[j].y += (Math.random() - 0.5) * minDist;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

// ---- Component ----

export default function FischMap({ locations, gameSlug }: Props) {
  const mappable = useMemo(() => locations.filter(l => l.coords), [locations]);

  // Layout: normalize coordinates → 0..SVG_W / 0..SVG_H, then resolve collisions
  const SVG_W = 1000, SVG_H = 650;
  const PAD = 60; // padding from edges
  const DOT_R = 6; // base dot radius
  const IMG_R = 14; // image circle radius
  const MIN_DIST = 42; // minimum distance between node centers

  const layoutMap = useMemo(() => {
    if (!mappable.length) return new Map<string, { x: number; y: number }>();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const l of mappable) {
      minX = Math.min(minX, l.coords!.x); maxX = Math.max(maxX, l.coords!.x);
      minZ = Math.min(minZ, l.coords!.z); maxZ = Math.max(maxZ, l.coords!.z);
    }
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;
    const usableW = SVG_W - PAD * 2;
    const usableH = SVG_H - PAD * 2;

    // Normalize to SVG space
    const nodes: LayoutNode[] = mappable.map(l => ({
      id: l.id,
      x: PAD + ((l.coords!.x - minX) / rangeX) * usableW,
      y: PAD + ((l.coords!.z - minZ) / rangeZ) * usableH,
    }));

    // Resolve overlaps
    const resolved = resolveCollisions(nodes, MIN_DIST);

    // Clamp to SVG bounds
    const map = new Map<string, { x: number; y: number }>();
    for (const n of resolved) {
      map.set(n.id, {
        x: Math.max(PAD, Math.min(SVG_W - PAD, n.x)),
        y: Math.max(PAD, Math.min(SVG_H - PAD, n.y)),
      });
    }
    return map;
  }, [mappable]);

  // State
  const [filter, setFilter] = useState<'all' | 'first' | 'second' | 'event'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MapLocation | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);

  // URL param ?loc=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locParam = params.get('location') || params.get('loc');
    if (locParam) {
      const found = mappable.find(l => l.id === locParam);
      if (found) setSelected(found);
    }
  }, [mappable]);

  // Filter
  const filtered = useMemo(() => {
    let locs = mappable;
    if (filter === 'first') locs = locs.filter(l => !l.isEvent && !l.name.includes('Second Sea') && !l.id.includes('second-sea'));
    else if (filter === 'second') locs = locs.filter(l => l.name.includes('Second Sea') || l.id.includes('second-sea') || l.id.includes('waveborne') || l.id.includes('azure-lagoon'));
    else if (filter === 'event') locs = locs.filter(l => l.isEvent);
    if (search) {
      const q = search.toLowerCase();
      locs = locs.filter(l => l.name.toLowerCase().includes(q) || l.fish.some(f => f.name.toLowerCase().includes(q)));
    }
    return locs;
  }, [mappable, filter, search]);

  const filteredIds = useMemo(() => new Set(filtered.map(l => l.id)), [filtered]);

  // Selected fish sorted by rarity
  const selectedFish = useMemo(() => {
    if (!selected) return [];
    let fish = [...selected.fish].sort((a, b) => (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0));
    if (rarityFilter) fish = fish.filter(f => f.rarity === rarityFilter);
    return fish;
  }, [selected, rarityFilter]);

  const selectedRarities = useMemo(() => {
    if (!selected) return [];
    const r = new Set(selected.fish.map(f => f.rarity));
    return Array.from(r).sort((a, b) => (RARITY_ORDER[b] || 0) - (RARITY_ORDER[a] || 0));
  }, [selected]);

  const handleClick = (loc: MapLocation) => {
    setSelected(prev => prev?.id === loc.id ? null : loc);
    setRarityFilter(null);
  };

  // ---- Render ----
  return (
    <div className="fm">
      {/* Toolbar */}
      <div className="fm-toolbar">
        <div className="fm-search">
          <svg className="fm-search__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" placeholder="Search location or fish..." value={search} onChange={e => setSearch(e.target.value)} className="fm-search__input"/>
          {search && <button onClick={() => setSearch('')} className="fm-search__clear" aria-label="Clear">&times;</button>}
        </div>
        <div className="fm-filters">
          {(['all', 'first', 'second', 'event'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`fm-chip${filter === f ? ' fm-chip--on' : ''}`}>
              {f === 'all' ? 'All' : f === 'first' ? 'First Sea' : f === 'second' ? 'Second Sea' : 'Events'}
            </button>
          ))}
          <span className="fm-count">{filtered.length} locations</span>
        </div>
      </div>

      {/* Main area: map + panel */}
      <div className="fm-body">
        {/* SVG Map */}
        <div className="fm-map-wrap">
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="fm-svg" preserveAspectRatio="xMidYMid meet">
            <defs>
              <radialGradient id="ocean-bg" cx="50%" cy="50%" r="70%">
                <stop offset="0%" stopColor="#0c2240"/>
                <stop offset="100%" stopColor="#060e1e"/>
              </radialGradient>
              <filter id="ds" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor="#000" floodOpacity="0.7"/>
              </filter>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
              {/* Clip paths for images */}
              {mappable.map(loc => {
                const pos = layoutMap.get(loc.id);
                return loc.imagePath && pos ? (
                  <clipPath key={`c-${loc.id}`} id={`c-${loc.id}`}>
                    <circle cx={pos.x} cy={pos.y} r={IMG_R}/>
                  </clipPath>
                ) : null;
              })}
            </defs>

            {/* Ocean */}
            <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="url(#ocean-bg)" rx="8"/>

            {/* Subtle grid */}
            {Array.from({ length: 10 }, (_, i) => (
              <g key={`g${i}`}>
                <line x1={100 * i + 50} y1="0" x2={100 * i + 50} y2={SVG_H} stroke="rgba(255,255,255,0.025)" strokeWidth="0.5"/>
                <line x1="0" y1={65 * i + 32} x2={SVG_W} y2={65 * i + 32} stroke="rgba(255,255,255,0.025)" strokeWidth="0.5"/>
              </g>
            ))}

            {/* Islands */}
            {mappable.map(loc => {
              const pos = layoutMap.get(loc.id);
              if (!pos) return null;
              const visible = filteredIds.has(loc.id);
              const isSel = selected?.id === loc.id;
              const color = RARITY_COLORS[getHighestRarity(loc.fish)] || '#1DA2D8';
              const hasImg = !!loc.imagePath;
              const r = hasImg ? IMG_R : DOT_R;

              return (
                <g key={loc.id} opacity={visible ? 1 : 0.15} className="fm-node" onClick={() => visible && handleClick(loc)} style={{ cursor: visible ? 'pointer' : 'default' }}>
                  {/* Selection pulse */}
                  {isSel && (
                    <circle cx={pos.x} cy={pos.y} r={r + 8} fill="none" stroke={color} strokeWidth="2" opacity="0.6">
                      <animate attributeName="r" from={r + 4} to={r + 14} dur="1.5s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite"/>
                    </circle>
                  )}

                  {/* Glow halo */}
                  <circle cx={pos.x} cy={pos.y} r={r + 4} fill={color} opacity={isSel ? 0.25 : 0.1}/>

                  {hasImg ? (
                    <>
                      <circle cx={pos.x} cy={pos.y} r={IMG_R + 1.5} fill="none" stroke={isSel ? '#fff' : color} strokeWidth={isSel ? 2 : 1} opacity={0.8}/>
                      <image href={loc.imagePath!} x={pos.x - IMG_R} y={pos.y - IMG_R} width={IMG_R * 2} height={IMG_R * 2} clipPath={`url(#c-${loc.id})`} preserveAspectRatio="xMidYMid slice"/>
                    </>
                  ) : (
                    <circle cx={pos.x} cy={pos.y} r={DOT_R} fill={color} stroke={isSel ? '#fff' : 'rgba(255,255,255,0.2)'} strokeWidth={isSel ? 1.5 : 0.5} filter="url(#glow)"/>
                  )}

                  {/* Label */}
                  <text x={pos.x} y={pos.y + r + 10} textAnchor="middle" fill={isSel ? '#fff' : '#CBD5E1'} fontSize="5.5" fontFamily="Inter,system-ui,sans-serif" fontWeight={isSel ? '700' : '500'} filter="url(#ds)">{loc.name}</text>

                  {/* Fish count */}
                  {loc.fishCount > 0 && (
                    <>
                      <circle cx={pos.x + r - 1} cy={pos.y - r + 1} r="5" fill="#0F1D35" stroke={color} strokeWidth="0.7"/>
                      <text x={pos.x + r - 1} y={pos.y - r + 2.8} textAnchor="middle" fill="#E2E8F0" fontSize="3.5" fontFamily="monospace" fontWeight="700">{loc.fishCount}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Info Panel — desktop: side, mobile: below */}
        {selected && (
          <div className="fm-panel">
            <div className="fm-panel__head">
              <div>
                <h3 className="fm-panel__title">{selected.name}</h3>
                <div className="fm-panel__meta">
                  <span>{selected.fishCount} fish</span>
                  {selected.isPremium && <span className="fm-badge fm-badge--premium">Premium</span>}
                  {selected.isEvent && <span className="fm-badge fm-badge--event">Event</span>}
                  {selected.isSeasonal && <span className="fm-badge fm-badge--seasonal">Seasonal</span>}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="fm-panel__close" aria-label="Close">&times;</button>
            </div>

            {selected.imagePath && <img src={selected.imagePath} alt={selected.name} className="fm-panel__img"/>}

            {selected.availableWeathers.length > 0 && (
              <div className="fm-panel__weather">
                <span className="fm-panel__label">Weather:</span>
                {selected.availableWeathers.map(w => <span key={w} className="fm-weather-chip">{w}</span>)}
              </div>
            )}

            {selectedRarities.length > 1 && (
              <div className="fm-panel__rchips">
                <button onClick={() => setRarityFilter(null)} className="fm-rchip" style={{ borderColor: !rarityFilter ? '#1DA2D8' : undefined, color: !rarityFilter ? '#1DA2D8' : undefined }}>All</button>
                {selectedRarities.map(r => (
                  <button key={r} onClick={() => setRarityFilter(rarityFilter === r ? null : r)} className="fm-rchip" style={{ borderColor: rarityFilter === r ? RARITY_COLORS[r] : undefined, color: rarityFilter === r ? RARITY_COLORS[r] : undefined }}>{r}</button>
                ))}
              </div>
            )}

            <div className="fm-panel__fish">
              {selectedFish.length === 0 && <div className="fm-panel__empty">No fish data available</div>}
              {selectedFish.map((f, i) => (
                <a key={`${f.name}-${i}`} href={`/games/${gameSlug}/fish/${f.id || slugify(f.name)}/`} className="fm-fish">
                  <span className="fm-fish__dot" style={{ background: RARITY_COLORS[f.rarity] || '#888' }}/>
                  <span className="fm-fish__name">{f.name}</span>
                  <span className="fm-fish__rarity" style={{ color: RARITY_COLORS[f.rarity] || '#888' }}>{f.rarity}</span>
                </a>
              ))}
            </div>

            <a href={`/games/${gameSlug}/locations/${selected.id}/`} className="fm-panel__viewall">
              View All Fish in {selected.name} &rarr;
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
