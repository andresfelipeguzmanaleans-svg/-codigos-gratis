import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// ---- Types ----

interface FishEntry {
  name: string;
  rarity: string;
  id?: string;
}

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

interface Props {
  locations: MapLocation[];
  gameSlug: string;
}

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
  if (!fish || fish.length === 0) return 'Common';
  let best = 'Common';
  let bestOrder = 0;
  for (const f of fish) {
    const order = RARITY_ORDER[f.rarity] || 0;
    if (order > bestOrder) {
      bestOrder = order;
      best = f.rarity;
    }
  }
  return best;
}

function getDotRadius(fishCount: number): number {
  return Math.max(5, Math.min(18, Math.sqrt(fishCount) * 2.2));
}

// ---- Component ----

export default function FischMap({ locations, gameSlug }: Props) {
  // Filter to only locations with coords
  const mappable = useMemo(() =>
    locations.filter(l => l.coords != null),
    [locations]
  );

  // Compute bounds
  const bounds = useMemo(() => {
    if (mappable.length === 0) return { minX: -4000, maxX: 4000, minZ: -4000, maxZ: 4000 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const l of mappable) {
      if (!l.coords) continue;
      minX = Math.min(minX, l.coords.x);
      maxX = Math.max(maxX, l.coords.x);
      minZ = Math.min(minZ, l.coords.z);
      maxZ = Math.max(maxZ, l.coords.z);
    }
    const padX = (maxX - minX) * 0.15 || 500;
    const padZ = (maxZ - minZ) * 0.15 || 500;
    return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
  }, [mappable]);

  // State
  const [filter, setFilter] = useState<'all' | 'first' | 'second' | 'event'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MapLocation | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; loc: MapLocation } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);

  // Zoom/pan state
  const [viewBox, setViewBox] = useState({ x: bounds.minX, y: bounds.minZ, w: bounds.maxX - bounds.minX, h: bounds.maxZ - bounds.minZ });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, vx: 0, vy: 0 });

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Read ?location= URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const locParam = params.get('location') || params.get('loc');
    if (locParam) {
      const found = mappable.find(l => l.id === locParam);
      if (found) {
        setSelected(found);
        setPanelOpen(true);
        // Zoom to location
        if (found.coords) {
          const size = 2000;
          setViewBox({ x: found.coords.x - size / 2, y: found.coords.z - size / 2, w: size, h: size });
        }
      }
    }
  }, [mappable]);

  // Filter locations
  const filtered = useMemo(() => {
    let locs = mappable;

    if (filter === 'first') {
      locs = locs.filter(l => !l.isEvent && !l.name.includes('Second Sea') && !l.id.includes('second-sea'));
    } else if (filter === 'second') {
      locs = locs.filter(l => l.name.includes('Second Sea') || l.id.includes('second-sea') || l.id.includes('waveborne') || l.id.includes('azure-lagoon'));
    } else if (filter === 'event') {
      locs = locs.filter(l => l.isEvent);
    }

    if (search) {
      const q = search.toLowerCase();
      // Search by location name OR fish name
      locs = locs.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.fish.some(f => f.name.toLowerCase().includes(q))
      );
    }

    return locs;
  }, [mappable, filter, search]);

  // Highlighted location from fish search
  const highlightedIds = useMemo(() => {
    if (!search) return new Set<string>();
    const q = search.toLowerCase();
    const ids = new Set<string>();
    for (const l of mappable) {
      if (l.name.toLowerCase().includes(q) ||
          l.fish.some(f => f.name.toLowerCase().includes(q))) {
        ids.add(l.id);
      }
    }
    return ids;
  }, [mappable, search]);

  // --- Event handlers ---

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    const factor = e.deltaY > 0 ? 1.15 : 0.87;

    setViewBox(prev => {
      const newW = Math.max(500, Math.min(bounds.maxX - bounds.minX + 2000, prev.w * factor));
      const newH = Math.max(500, Math.min(bounds.maxZ - bounds.minZ + 2000, prev.h * factor));
      const newX = prev.x + (prev.w - newW) * mx;
      const newY = prev.y + (prev.h - newH) * my;
      return { x: newX, y: newY, w: newW, h: newH };
    });
  }, [bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y });
  }, [viewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) / rect.width * viewBox.w;
    const dy = (e.clientY - panStart.y) / rect.height * viewBox.h;

    setViewBox(prev => ({ ...prev, x: panStart.vx - dx, y: panStart.vy - dy }));
  }, [isPanning, panStart, viewBox.w, viewBox.h]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Touch support
  const touchRef = useRef<{ startX: number; startY: number; vx: number; vy: number; dist?: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchRef.current = { startX: t.clientX, startY: t.clientY, vx: viewBox.x, vy: viewBox.y };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current = { startX: 0, startY: 0, vx: viewBox.x, vy: viewBox.y, dist: Math.sqrt(dx * dx + dy * dy) };
    }
  }, [viewBox]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const svg = svgRef.current;
    if (!svg) return;

    if (e.touches.length === 1 && !touchRef.current.dist) {
      const t = e.touches[0];
      const rect = svg.getBoundingClientRect();
      const dx = (t.clientX - touchRef.current.startX) / rect.width * viewBox.w;
      const dy = (t.clientY - touchRef.current.startY) / rect.height * viewBox.h;
      setViewBox(prev => ({ ...prev, x: touchRef.current!.vx - dx, y: touchRef.current!.vy - dy }));
    } else if (e.touches.length === 2 && touchRef.current.dist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scale = touchRef.current.dist / newDist;
      setViewBox(prev => {
        const cx = prev.x + prev.w / 2;
        const cy = prev.y + prev.h / 2;
        const newW = Math.max(500, prev.w * scale);
        const newH = Math.max(500, prev.h * scale);
        return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
      });
      touchRef.current.dist = newDist;
    }
  }, [viewBox.w, viewBox.h]);

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null;
  }, []);

  const resetZoom = useCallback(() => {
    setViewBox({ x: bounds.minX, y: bounds.minZ, w: bounds.maxX - bounds.minX, h: bounds.maxZ - bounds.minZ });
  }, [bounds]);

  const handleDotHover = useCallback((e: React.MouseEvent, loc: MapLocation) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      loc,
    });
    setHoveredId(loc.id);
  }, []);

  const handleDotLeave = useCallback(() => {
    setTooltip(null);
    setHoveredId(null);
  }, []);

  const handleDotClick = useCallback((loc: MapLocation) => {
    setSelected(loc);
    setPanelOpen(true);
    setRarityFilter(null);
    // Zoom to location
    if (loc.coords) {
      const size = Math.max(1500, viewBox.w * 0.4);
      setViewBox({ x: loc.coords.x - size / 2, y: loc.coords.z - size / 2, w: size, h: size });
    }
  }, [viewBox.w]);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelected(null);
  }, []);

  // Fish list for selected location
  const selectedFish = useMemo(() => {
    if (!selected) return [];
    let fish = [...selected.fish].sort((a, b) =>
      (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0)
    );
    if (rarityFilter) {
      fish = fish.filter(f => f.rarity === rarityFilter);
    }
    return fish;
  }, [selected, rarityFilter]);

  const selectedRarities = useMemo(() => {
    if (!selected) return [];
    const rarities = new Set(selected.fish.map(f => f.rarity));
    return Array.from(rarities).sort((a, b) =>
      (RARITY_ORDER[b] || 0) - (RARITY_ORDER[a] || 0)
    );
  }, [selected]);

  // Zoom level indicator
  const zoomLevel = useMemo(() => {
    const fullW = bounds.maxX - bounds.minX;
    return Math.round((fullW / viewBox.w) * 100);
  }, [bounds, viewBox]);

  // ---- Render ----

  return (
    <div ref={containerRef} className="fisch-map-container" style={styles.container}>
      {/* TOOLBAR */}
      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <svg style={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            placeholder="Search location or fish..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          {search && (
            <button onClick={() => setSearch('')} style={styles.clearBtn} aria-label="Clear">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          )}
        </div>
        <div style={styles.filters}>
          {(['all', 'first', 'second', 'event'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...styles.filterChip,
                ...(filter === f ? styles.filterChipActive : {}),
              }}
            >
              {f === 'all' ? 'All' : f === 'first' ? 'First Sea' : f === 'second' ? 'Second Sea' : 'Events'}
            </button>
          ))}
        </div>
      </div>

      {/* MAP AREA */}
      <div style={styles.mapArea}>
        <div style={{ ...styles.mapWrap, cursor: isPanning ? 'grabbing' : 'grab' }}>
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            style={styles.svg}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Ocean background */}
            <defs>
              <radialGradient id="ocean-bg" cx="50%" cy="50%" r="70%">
                <stop offset="0%" stopColor="#0a1e3d" />
                <stop offset="60%" stopColor="#071428" />
                <stop offset="100%" stopColor="#040d1a" />
              </radialGradient>
              {/* Glow filter for hovered/selected */}
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            <rect x={viewBox.x - 5000} y={viewBox.y - 5000} width={viewBox.w + 10000} height={viewBox.h + 10000} fill="url(#ocean-bg)" />

            {/* Grid lines */}
            {Array.from({ length: 20 }, (_, i) => {
              const spacing = 1000;
              const startX = Math.floor(viewBox.x / spacing) * spacing;
              const startY = Math.floor(viewBox.y / spacing) * spacing;
              return (
                <g key={`grid-${i}`}>
                  <line
                    x1={startX + i * spacing} y1={viewBox.y - 1000}
                    x2={startX + i * spacing} y2={viewBox.y + viewBox.h + 1000}
                    stroke="rgba(255,255,255,0.03)" strokeWidth={viewBox.w / 800}
                  />
                  <line
                    x1={viewBox.x - 1000} y1={startY + i * spacing}
                    x2={viewBox.x + viewBox.w + 1000} y2={startY + i * spacing}
                    stroke="rgba(255,255,255,0.03)" strokeWidth={viewBox.w / 800}
                  />
                </g>
              );
            })}

            {/* Location dots */}
            {filtered.map(loc => {
              if (!loc.coords) return null;
              const r = getDotRadius(loc.fishCount);
              const highestRarity = getHighestRarity(loc.fish);
              const color = RARITY_COLORS[highestRarity] || '#1DA2D8';
              const isHighlighted = search ? highlightedIds.has(loc.id) : true;
              const isSelected = selected?.id === loc.id;
              const isHovered = hoveredId === loc.id;
              const scaledR = r * (viewBox.w / 8000);
              const fontSize = Math.max(10, viewBox.w / 60);

              return (
                <g key={loc.id}>
                  {/* Pulse ring for selected */}
                  {isSelected && (
                    <circle
                      cx={loc.coords.x} cy={loc.coords.z}
                      r={scaledR * 2.5}
                      fill="none" stroke={color} strokeWidth={scaledR * 0.3}
                      opacity={0.3}
                    >
                      <animate attributeName="r" from={scaledR * 1.5} to={scaledR * 3} dur="1.5s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" from="0.4" to="0" dur="1.5s" repeatCount="indefinite"/>
                    </circle>
                  )}

                  {/* Glow circle */}
                  <circle
                    cx={loc.coords.x} cy={loc.coords.z}
                    r={scaledR * 1.8}
                    fill={color}
                    opacity={(isHovered || isSelected) ? 0.2 : 0.08}
                    filter={(isHovered || isSelected) ? 'url(#glow-strong)' : undefined}
                  />

                  {/* Main dot */}
                  <circle
                    cx={loc.coords.x} cy={loc.coords.z}
                    r={scaledR}
                    fill={color}
                    opacity={isHighlighted ? 1 : 0.25}
                    stroke={isSelected ? '#fff' : (isHovered ? '#fff' : 'rgba(0,0,0,0.4)')}
                    strokeWidth={scaledR * (isSelected ? 0.4 : (isHovered ? 0.3 : 0.15))}
                    style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                    onMouseEnter={(e) => handleDotHover(e, loc)}
                    onMouseLeave={handleDotLeave}
                    onClick={(e) => { e.stopPropagation(); handleDotClick(loc); }}
                  />

                  {/* Location image thumbnail (if zoomed in enough) */}
                  {loc.imagePath && viewBox.w < 5000 && (
                    <image
                      href={loc.imagePath}
                      x={loc.coords.x - scaledR * 1.2}
                      y={loc.coords.z - scaledR * 1.2}
                      width={scaledR * 2.4}
                      height={scaledR * 2.4}
                      clipPath={`circle(${scaledR * 1.1}px at ${scaledR * 1.2}px ${scaledR * 1.2}px)`}
                      style={{ pointerEvents: 'none', borderRadius: '50%' }}
                      opacity={isHighlighted ? 0.9 : 0.3}
                    />
                  )}

                  {/* Label */}
                  {viewBox.w < 6000 && (
                    <text
                      x={loc.coords.x}
                      y={loc.coords.z + scaledR + fontSize * 1.2}
                      textAnchor="middle"
                      fill={isHighlighted ? '#E2E8F0' : 'rgba(226,232,240,0.3)'}
                      fontSize={fontSize}
                      fontFamily="Inter, system-ui, sans-serif"
                      fontWeight={isSelected ? '700' : '500'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {loc.name}
                    </text>
                  )}

                  {/* Fish count badge */}
                  {viewBox.w < 4000 && loc.fishCount > 0 && (
                    <>
                      <circle
                        cx={loc.coords.x + scaledR * 0.9}
                        cy={loc.coords.z - scaledR * 0.9}
                        r={fontSize * 0.7}
                        fill="#0F1D35"
                        stroke={color}
                        strokeWidth={fontSize * 0.08}
                      />
                      <text
                        x={loc.coords.x + scaledR * 0.9}
                        y={loc.coords.z - scaledR * 0.9 + fontSize * 0.25}
                        textAnchor="middle"
                        fill="#E2E8F0"
                        fontSize={fontSize * 0.6}
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="700"
                        style={{ pointerEvents: 'none' }}
                      >
                        {loc.fishCount}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Tooltip */}
          {tooltip && (
            <div style={{
              ...styles.tooltip,
              left: tooltip.x + 12,
              top: tooltip.y - 8,
            }}>
              {tooltip.loc.imagePath && (
                <img
                  src={tooltip.loc.imagePath}
                  alt=""
                  style={styles.tooltipImg}
                />
              )}
              <div>
                <div style={styles.tooltipName}>{tooltip.loc.name}</div>
                <div style={styles.tooltipMeta}>
                  {tooltip.loc.fishCount} fish
                  {tooltip.loc.isPremium && <span style={styles.badgePremium}>Premium</span>}
                  {tooltip.loc.isEvent && <span style={styles.badgeEvent}>Event</span>}
                </div>
              </div>
            </div>
          )}

          {/* Zoom controls */}
          <div style={styles.zoomControls}>
            <button
              onClick={() => setViewBox(prev => {
                const factor = 0.75;
                const cx = prev.x + prev.w / 2;
                const cy = prev.y + prev.h / 2;
                const newW = prev.w * factor;
                const newH = prev.h * factor;
                return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
              })}
              style={styles.zoomBtn}
              title="Zoom In"
            >+</button>
            <span style={styles.zoomLevel}>{zoomLevel}%</span>
            <button
              onClick={() => setViewBox(prev => {
                const factor = 1.35;
                const cx = prev.x + prev.w / 2;
                const cy = prev.y + prev.h / 2;
                const newW = Math.min(bounds.maxX - bounds.minX + 2000, prev.w * factor);
                const newH = Math.min(bounds.maxZ - bounds.minZ + 2000, prev.h * factor);
                return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
              })}
              style={styles.zoomBtn}
              title="Zoom Out"
            >-</button>
            <button onClick={resetZoom} style={styles.zoomBtn} title="Reset Zoom">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>
              </svg>
            </button>
          </div>

          {/* Location count */}
          <div style={styles.locCount}>
            {filtered.length} location{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* SIDE PANEL (desktop) / BOTTOM SHEET (mobile) */}
        {panelOpen && selected && (
          <>
            {/* Overlay for mobile */}
            <div style={styles.panelOverlay} onClick={closePanel} />
            <div className="fisch-map-panel" style={styles.panel}>
              <div style={styles.panelHeader}>
                <div>
                  <h3 style={styles.panelTitle}>{selected.name}</h3>
                  <div style={styles.panelMeta}>
                    <span>{selected.fishCount} fish</span>
                    {selected.isPremium && <span style={styles.badgePremium}>Premium</span>}
                    {selected.isEvent && <span style={styles.badgeEvent}>Event</span>}
                    {selected.isSeasonal && <span style={styles.badgeSeasonal}>Seasonal</span>}
                  </div>
                </div>
                <button onClick={closePanel} style={styles.panelClose} aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                  </svg>
                </button>
              </div>

              {selected.imagePath && (
                <img src={selected.imagePath} alt={selected.name} style={styles.panelImage} />
              )}

              {selected.availableWeathers && selected.availableWeathers.length > 0 && (
                <div style={styles.panelWeather}>
                  <span style={styles.panelLabel}>Weather:</span>
                  {selected.availableWeathers.map(w => (
                    <span key={w} style={styles.weatherChip}>{w}</span>
                  ))}
                </div>
              )}

              {/* Rarity filter chips */}
              {selectedRarities.length > 1 && (
                <div style={styles.rarityChips}>
                  <button
                    onClick={() => setRarityFilter(null)}
                    style={{
                      ...styles.rarityChip,
                      borderColor: !rarityFilter ? '#1DA2D8' : 'rgba(255,255,255,0.08)',
                      color: !rarityFilter ? '#1DA2D8' : '#94A3B8',
                    }}
                  >All</button>
                  {selectedRarities.map(r => (
                    <button
                      key={r}
                      onClick={() => setRarityFilter(rarityFilter === r ? null : r)}
                      style={{
                        ...styles.rarityChip,
                        borderColor: rarityFilter === r ? (RARITY_COLORS[r] || '#888') : 'rgba(255,255,255,0.08)',
                        color: rarityFilter === r ? (RARITY_COLORS[r] || '#888') : '#94A3B8',
                      }}
                    >{r}</button>
                  ))}
                </div>
              )}

              {/* Fish list */}
              <div style={styles.fishList}>
                {selectedFish.length === 0 && (
                  <div style={styles.emptyFish}>No fish data available</div>
                )}
                {selectedFish.map((f, i) => (
                  <a
                    key={`${f.name}-${i}`}
                    href={`/games/${gameSlug}/fish/${f.id || slugify(f.name)}/`}
                    style={styles.fishItem}
                  >
                    <span style={{
                      ...styles.fishDot,
                      background: RARITY_COLORS[f.rarity] || '#888',
                    }} />
                    <span style={styles.fishName}>{f.name}</span>
                    <span style={{
                      ...styles.fishRarity,
                      color: RARITY_COLORS[f.rarity] || '#888',
                    }}>{f.rarity}</span>
                  </a>
                ))}
              </div>

              {/* View all link */}
              <a
                href={`/games/${gameSlug}/locations/${selected.id}/`}
                style={styles.viewAllLink}
              >
                View All Fish in {selected.name} →
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Styles ----

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100dvh - 56px - 80px)',
    minHeight: '500px',
    background: '#060B18',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(15,29,53,0.8)',
    flexWrap: 'wrap' as const,
    zIndex: 10,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flex: '1 1 200px',
    minWidth: '160px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '0.4rem 0.75rem',
  },
  searchIcon: {
    width: '16px',
    height: '16px',
    color: '#94A3B8',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#E2E8F0',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '0.85rem',
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    color: '#94A3B8',
    cursor: 'pointer',
    padding: '2px',
  },
  filters: {
    display: 'flex',
    gap: '0.35rem',
    flexWrap: 'wrap' as const,
  },
  filterChip: {
    padding: '0.3rem 0.7rem',
    borderRadius: '9999px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'transparent',
    color: '#94A3B8',
    fontSize: '0.75rem',
    fontWeight: 500,
    fontFamily: 'Inter, system-ui, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  },
  filterChipActive: {
    borderColor: '#1DA2D8',
    color: '#1DA2D8',
    background: 'rgba(29,162,216,0.1)',
  },

  mapArea: {
    flex: 1,
    position: 'relative' as const,
    overflow: 'hidden',
  },
  mapWrap: {
    width: '100%',
    height: '100%',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  svg: {
    width: '100%',
    height: '100%',
    display: 'block',
    touchAction: 'none',
  },

  tooltip: {
    position: 'absolute' as const,
    pointerEvents: 'none' as const,
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.5rem 0.75rem',
    background: 'rgba(15,29,53,0.95)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    zIndex: 50,
    maxWidth: '250px',
  },
  tooltipImg: {
    width: '40px',
    height: '40px',
    borderRadius: '6px',
    objectFit: 'cover' as const,
    flexShrink: 0,
  },
  tooltipName: {
    color: '#fff',
    fontWeight: 600,
    fontSize: '0.85rem',
    lineHeight: 1.3,
  },
  tooltipMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    color: '#94A3B8',
    fontSize: '0.75rem',
    marginTop: '2px',
  },

  badgePremium: {
    fontSize: '0.6rem',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '4px',
    background: 'rgba(249,115,22,0.15)',
    color: '#F97316',
    border: '1px solid rgba(249,115,22,0.3)',
  },
  badgeEvent: {
    fontSize: '0.6rem',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '4px',
    background: 'rgba(168,85,247,0.15)',
    color: '#a855f7',
    border: '1px solid rgba(168,85,247,0.3)',
  },
  badgeSeasonal: {
    fontSize: '0.6rem',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '4px',
    background: 'rgba(34,211,238,0.15)',
    color: '#22D3EE',
    border: '1px solid rgba(34,211,238,0.3)',
  },

  zoomControls: {
    position: 'absolute' as const,
    bottom: '1rem',
    right: '1rem',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '4px',
    zIndex: 20,
  },
  zoomBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: 'rgba(15,29,53,0.9)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#E2E8F0',
    fontSize: '1.1rem',
    fontWeight: 700,
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  zoomLevel: {
    fontSize: '0.6rem',
    color: '#94A3B8',
    fontFamily: 'JetBrains Mono, monospace',
    fontWeight: 600,
  },

  locCount: {
    position: 'absolute' as const,
    bottom: '1rem',
    left: '1rem',
    fontSize: '0.7rem',
    color: '#94A3B8',
    fontWeight: 500,
    background: 'rgba(15,29,53,0.9)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    padding: '0.25rem 0.6rem',
    backdropFilter: 'blur(8px)',
    zIndex: 20,
  },

  // Panel (desktop: right side, mobile: bottom sheet)
  panelOverlay: {
    position: 'absolute' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
    zIndex: 30,
  },
  panel: {
    position: 'absolute' as const,
    zIndex: 40,
    background: '#0F1D35',
    border: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    // Desktop: right side panel
    right: 0,
    top: 0,
    bottom: 0,
    width: '340px',
    borderRadius: '0',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '1rem 1rem 0.75rem',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  panelTitle: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#fff',
    margin: 0,
    lineHeight: 1.3,
  },
  panelMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.8rem',
    color: '#94A3B8',
    marginTop: '4px',
  },
  panelClose: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: 'none',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#94A3B8',
    cursor: 'pointer',
    flexShrink: 0,
  },
  panelImage: {
    width: '100%',
    height: '140px',
    objectFit: 'cover' as const,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  panelWeather: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.6rem 1rem',
    flexWrap: 'wrap' as const,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  panelLabel: {
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#94A3B8',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  weatherChip: {
    fontSize: '0.7rem',
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: '4px',
    background: 'rgba(29,162,216,0.1)',
    color: '#1DA2D8',
    border: '1px solid rgba(29,162,216,0.2)',
  },
  rarityChips: {
    display: 'flex',
    gap: '0.3rem',
    padding: '0.5rem 1rem',
    flexWrap: 'wrap' as const,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  rarityChip: {
    fontSize: '0.65rem',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '9999px',
    background: 'transparent',
    border: '1px solid',
    cursor: 'pointer',
    fontFamily: 'Inter, system-ui, sans-serif',
    whiteSpace: 'nowrap' as const,
  },
  fishList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0.5rem',
  },
  emptyFish: {
    textAlign: 'center' as const,
    padding: '2rem 1rem',
    color: '#64748b',
    fontSize: '0.85rem',
  },
  fishItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.4rem 0.6rem',
    borderRadius: '6px',
    textDecoration: 'none',
    color: '#E2E8F0',
    fontSize: '0.82rem',
    transition: 'background 0.1s',
    cursor: 'pointer',
  },
  fishDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  fishName: {
    flex: 1,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fishRarity: {
    fontSize: '0.7rem',
    fontWeight: 600,
    flexShrink: 0,
  },
  viewAllLink: {
    display: 'block',
    padding: '0.75rem 1rem',
    textAlign: 'center' as const,
    color: '#1DA2D8',
    fontSize: '0.8rem',
    fontWeight: 600,
    borderTop: '1px solid rgba(255,255,255,0.08)',
    textDecoration: 'none',
    transition: 'background 0.15s',
  },
};

// Add responsive styles via CSS-in-JS media query workaround
// The panel switches to bottom sheet on mobile via a style tag
const responsiveCSS = `
  @media (max-width: 767px) {
    .fisch-map-panel {
      right: 0 !important;
      top: auto !important;
      bottom: 0 !important;
      left: 0 !important;
      width: 100% !important;
      max-height: 60vh !important;
      border-radius: 16px 16px 0 0 !important;
      border-left: none !important;
      border-top: 1px solid rgba(255,255,255,0.12) !important;
    }
    .fisch-map-container {
      height: calc(100dvh - 56px - 60px - 40px) !important;
    }
  }
`;

// Inject responsive styles on mount
if (typeof document !== 'undefined') {
  const existingStyle = document.getElementById('fisch-map-responsive');
  if (!existingStyle) {
    const style = document.createElement('style');
    style.id = 'fisch-map-responsive';
    style.textContent = responsiveCSS;
    document.head.appendChild(style);
  }
}
