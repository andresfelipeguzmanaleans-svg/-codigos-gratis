import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

// ---------- Types ----------

export interface ValueRow {
  id: string;
  name: string;
  rarity: string;
  baseValue: number | null;
  baseWeight: number | null;
  weightMax: number | null;
  location: string | null;
  image: string | null;
  imageUrl: string | null;
  event: string | null;
}

interface Props {
  items: ValueRow[];
  rarities: string[];
  maxBaseValue: number;
}

// ---------- Constants ----------

const PAGE_SIZE = 50;

const RARITY_ORDER: Record<string, number> = {
  'Apex': 0, 'Divine Secret': 1, 'Gemstone': 2, 'Relic': 3, 'Exotic': 4,
  'Secret': 5, 'Mythical': 6, 'Legendary': 7, 'Rare': 8, 'Unusual': 9,
  'Uncommon': 10, 'Common': 11, 'Special': 12, 'Limited': 13, 'Extinct': 14,
  'Fragment': 15, 'Trash': 16,
};

const RARITY_COLORS: Record<string, string> = {
  'Trash': '#71717a', 'Common': '#9ca3af', 'Uncommon': '#22c55e', 'Unusual': '#34d39e',
  'Rare': '#3b82f6', 'Legendary': '#f59e0b', 'Mythical': '#a855f7', 'Exotic': '#ec4899',
  'Limited': '#ef4444', 'Special': '#06b6d4', 'Secret': '#fbbf24', 'Divine Secret': '#fde68a',
  'Apex': '#f43f5e', 'Extinct': '#a8a29e', 'Relic': '#c084fc', 'Gemstone': '#2dd4bf',
  'Fragment': '#67e8f9',
};

type SortKey = 'name' | 'value' | 'estMax' | 'rarity' | 'weight';
type SortDir = 'asc' | 'desc';

function fmtC(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function estMax(row: ValueRow): number {
  if (!row.baseValue || !row.weightMax) return 0;
  return row.baseValue * row.weightMax;
}

// ---------- Component ----------

export default function ValueTable({ items, rarities, maxBaseValue }: Props) {
  const [search, setSearch] = useState('');
  const [selRarities, setSelRarities] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [showRarityPanel, setShowRarityPanel] = useState(false);
  const [minVal, setMinVal] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowRarityPanel(false);
    }
    if (showRarityPanel) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showRarityPanel]);

  const toggleRarity = useCallback((r: string) => {
    setSelRarities(prev => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r); else next.add(r);
      return next;
    });
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelRarities(new Set());
    setMinVal(0);
    setPage(0);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = items;

    if (q) list = list.filter(f => f.name.toLowerCase().includes(q));
    if (selRarities.size > 0) list = list.filter(f => selRarities.has(f.rarity));
    if (minVal > 0) list = list.filter(f => (f.baseValue ?? 0) >= minVal);

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'value': return dir * ((a.baseValue ?? -1) - (b.baseValue ?? -1));
        case 'estMax': return dir * (estMax(a) - estMax(b));
        case 'rarity': return dir * ((RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99));
        case 'weight': return dir * ((a.weightMax ?? -1) - (b.weightMax ?? -1));
        default: return 0;
      }
    });

    return list;
  }, [items, search, selRarities, minVal, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
    setPage(0);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const hasFilters = search || selRarities.size > 0 || minVal > 0;

  // Slider steps (log-ish scale)
  const valSteps = [0, 10, 50, 100, 500, 1000, 5000, 10000, 30000, 50000, 120000];
  const sliderIdx = valSteps.indexOf(minVal) >= 0 ? valSteps.indexOf(minVal) : 0;

  return (
    <div className="vt">
      {/* FILTERS */}
      <div className="vt__filters">
        <div className="vt__search-wrap">
          <svg className="vt__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            className="vt__search"
            type="text"
            placeholder="Search fish..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <div className="vt__filter-row">
          <div className="vt__rarity-wrap" ref={panelRef}>
            <button
              className="vt__filter-btn"
              onClick={() => setShowRarityPanel(!showRarityPanel)}
              type="button"
            >
              Rarity{selRarities.size > 0 ? ` (${selRarities.size})` : ''}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {showRarityPanel && (
              <div className="vt__rarity-panel">
                {rarities.map(r => (
                  <label key={r} className="vt__rarity-opt">
                    <input
                      type="checkbox"
                      checked={selRarities.has(r)}
                      onChange={() => toggleRarity(r)}
                    />
                    <span className="vt__rarity-dot" style={{ background: RARITY_COLORS[r] || '#888' }} />
                    <span>{r}</span>
                    <span className="vt__rarity-cnt">
                      {items.filter(f => f.rarity === r).length}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Min value slider */}
          <div className="vt__slider-wrap">
            <label className="vt__slider-label">
              Min value: {minVal > 0 ? `${fmtC(minVal)} C$/kg` : 'Any'}
            </label>
            <input
              className="vt__slider"
              type="range"
              min={0}
              max={valSteps.length - 1}
              value={sliderIdx}
              onChange={e => { setMinVal(valSteps[parseInt(e.target.value)]); setPage(0); }}
            />
          </div>

          {hasFilters && (
            <button className="vt__clear" onClick={clearFilters} type="button">Clear</button>
          )}
        </div>
      </div>

      {/* COUNT */}
      <div className="vt__count">
        {filtered.length === items.length
          ? `${items.length} fish`
          : `${filtered.length} of ${items.length} fish`}
      </div>

      {/* TABLE */}
      <div className="vt__table-wrap">
        <table className="vt__table">
          <thead>
            <tr>
              <th className="vt__th vt__th--img"></th>
              <th className="vt__th vt__th--name" onClick={() => handleSort('name')}>
                Name{sortIcon('name')}
              </th>
              <th className="vt__th vt__th--rarity" onClick={() => handleSort('rarity')}>
                Rarity{sortIcon('rarity')}
              </th>
              <th className="vt__th vt__th--val" onClick={() => handleSort('value')}>
                Base Value{sortIcon('value')}
              </th>
              <th className="vt__th vt__th--est" onClick={() => handleSort('estMax')}>
                Est. Max{sortIcon('estMax')}
              </th>
              <th className="vt__th vt__th--loc">Location</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(f => {
              const est = estMax(f);
              const rc = RARITY_COLORS[f.rarity] || '#888';
              return (
                <tr
                  key={f.id}
                  className="vt__row"
                  onClick={() => { window.location.href = `/games/fisch/fish/${f.id}/`; }}
                >
                  <td className="vt__td vt__td--img">
                    {f.imageUrl ? (
                      <img
                        className="vt__thumb"
                        src={f.imageUrl}
                        alt=""
                        loading="lazy"
                        onError={(e: any) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="vt__thumb-ph" />
                    )}
                  </td>
                  <td className="vt__td vt__td--name">
                    <a
                      href={`/games/fisch/fish/${f.id}/`}
                      className="vt__name-link"
                      onClick={e => e.stopPropagation()}
                    >
                      {f.name}
                    </a>
                  </td>
                  <td className="vt__td vt__td--rarity">
                    <span
                      className="vt__badge"
                      style={{
                        color: rc,
                        borderColor: rc + '40',
                        background: rc + '15',
                      }}
                    >
                      {f.rarity}
                    </span>
                  </td>
                  <td className="vt__td vt__td--val">
                    {f.baseValue != null ? (
                      <span className="vt__val">{f.baseValue.toLocaleString('en-US')} C$/kg</span>
                    ) : '—'}
                  </td>
                  <td className="vt__td vt__td--est">
                    {est > 0 ? (
                      <span className="vt__est">{fmtC(est)} C$</span>
                    ) : '—'}
                  </td>
                  <td className="vt__td vt__td--loc">
                    {f.location || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="vt__empty">
          No fish match your filters.
          <button className="vt__clear" onClick={clearFilters} type="button">Clear filters</button>
        </div>
      )}

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="vt__pag">
          <button className="vt__pag-btn" disabled={page === 0} onClick={() => setPage(0)} type="button">««</button>
          <button className="vt__pag-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)} type="button">«</button>
          <span className="vt__pag-info">{page + 1} / {totalPages}</span>
          <button className="vt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} type="button">»</button>
          <button className="vt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} type="button">»»</button>
        </div>
      )}
    </div>
  );
}
