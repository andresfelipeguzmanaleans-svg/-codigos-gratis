import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

// ---------- Types ----------

export interface FishRow {
  id: string;
  name: string;
  rarity: string;
  baseValue: number | null;
  location: string | null;
  event: string | null;
  baseWeight: number | null;
  image: string | null;
}

interface Props {
  fish: FishRow[];
  rarities: string[];
  locations: string[];
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

type SortKey = 'name' | 'value' | 'rarity' | 'weight';
type SortDir = 'asc' | 'desc';

// ---------- Component ----------

export default function FishTable({ fish, rarities, locations }: Props) {
  const [search, setSearch] = useState('');
  const [selRarities, setSelRarities] = useState<Set<string>>(new Set());
  const [selLocation, setSelLocation] = useState('');
  const [eventOnly, setEventOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [showRarityPanel, setShowRarityPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close rarity panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowRarityPanel(false);
      }
    }
    if (showRarityPanel) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
    setSelLocation('');
    setEventOnly(false);
    setPage(0);
  }, []);

  // Filter + sort
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = fish;

    if (q) list = list.filter(f => f.name.toLowerCase().includes(q));
    if (selRarities.size > 0) list = list.filter(f => selRarities.has(f.rarity));
    if (selLocation) list = list.filter(f => f.location === selLocation);
    if (eventOnly) list = list.filter(f => f.event);

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'value':
          return dir * ((a.baseValue ?? -1) - (b.baseValue ?? -1));
        case 'rarity':
          return dir * ((RARITY_ORDER[a.rarity] ?? 99) - (RARITY_ORDER[b.rarity] ?? 99));
        case 'weight':
          return dir * ((a.baseWeight ?? -1) - (b.baseWeight ?? -1));
        default:
          return 0;
      }
    });

    return list;
  }, [fish, search, selRarities, selLocation, eventOnly, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const hasFilters = search || selRarities.size > 0 || selLocation || eventOnly;

  return (
    <div className="ft">
      {/* FILTERS */}
      <div className="ft__filters">
        <div className="ft__search-wrap">
          <svg className="ft__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            className="ft__search"
            type="text"
            placeholder="Search fish..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <div className="ft__filter-row">
          {/* Rarity multi-select */}
          <div className="ft__rarity-wrap" ref={panelRef}>
            <button
              className="ft__filter-btn"
              onClick={() => setShowRarityPanel(!showRarityPanel)}
              type="button"
            >
              Rarity{selRarities.size > 0 ? ` (${selRarities.size})` : ''}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {showRarityPanel && (
              <div className="ft__rarity-panel">
                {rarities.map(r => (
                  <label key={r} className="ft__rarity-opt">
                    <input
                      type="checkbox"
                      checked={selRarities.has(r)}
                      onChange={() => toggleRarity(r)}
                    />
                    <span
                      className="ft__rarity-dot"
                      style={{ background: RARITY_COLORS[r] || '#888' }}
                    />
                    <span>{r}</span>
                    <span className="ft__rarity-cnt">
                      {fish.filter(f => f.rarity === r).length}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <select
            className="ft__select"
            value={selLocation}
            onChange={e => { setSelLocation(e.target.value); setPage(0); }}
          >
            <option value="">All Locations</option>
            {locations.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {/* Event only */}
          <label className="ft__event-label">
            <input
              type="checkbox"
              checked={eventOnly}
              onChange={e => { setEventOnly(e.target.checked); setPage(0); }}
            />
            <span>Event only</span>
          </label>

          {hasFilters && (
            <button className="ft__clear" onClick={clearFilters} type="button">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* COUNT */}
      <div className="ft__count">
        {filtered.length === fish.length
          ? `${fish.length} fish`
          : `${filtered.length} of ${fish.length} fish`}
      </div>

      {/* TABLE */}
      <div className="ft__table-wrap">
        <table className="ft__table">
          <thead>
            <tr>
              <th className="ft__th ft__th--img"></th>
              <th className="ft__th ft__th--name" onClick={() => handleSort('name')}>
                Name{sortIcon('name')}
              </th>
              <th className="ft__th ft__th--rarity" onClick={() => handleSort('rarity')}>
                Rarity{sortIcon('rarity')}
              </th>
              <th className="ft__th ft__th--value" onClick={() => handleSort('value')}>
                Value{sortIcon('value')}
              </th>
              <th className="ft__th ft__th--loc">Location</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(f => (
              <tr
                key={f.id}
                className="ft__row"
                onClick={() => { window.location.href = `/games/fisch/fish/${f.id}/`; }}
              >
                <td className="ft__td ft__td--img">
                  {f.image && f.image !== '.png' ? (
                    <img
                      className="ft__thumb"
                      src={`https://fischipedia.org/w/images/${encodeURIComponent(f.image)}`}
                      alt=""
                      loading="lazy"
                      onError={(e: any) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="ft__thumb-ph" />
                  )}
                </td>
                <td className="ft__td ft__td--name">
                  <a href={`/games/fisch/fish/${f.id}/`} className="ft__name-link" onClick={e => e.stopPropagation()}>
                    {f.name}
                  </a>
                </td>
                <td className="ft__td ft__td--rarity">
                  <span
                    className="ft__badge"
                    style={{
                      color: RARITY_COLORS[f.rarity] || '#888',
                      borderColor: (RARITY_COLORS[f.rarity] || '#888') + '40',
                      background: (RARITY_COLORS[f.rarity] || '#888') + '15',
                    }}
                  >
                    {f.rarity}
                  </span>
                </td>
                <td className="ft__td ft__td--value">
                  {f.baseValue != null ? `${f.baseValue.toLocaleString('en-US')} C$` : '—'}
                </td>
                <td className="ft__td ft__td--loc">
                  {f.location || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="ft__empty">
          No fish match your filters.
          <button className="ft__clear" onClick={clearFilters} type="button">Clear filters</button>
        </div>
      )}

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="ft__pag">
          <button
            className="ft__pag-btn"
            disabled={page === 0}
            onClick={() => setPage(0)}
            type="button"
          >
            ««
          </button>
          <button
            className="ft__pag-btn"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            type="button"
          >
            «
          </button>
          <span className="ft__pag-info">
            {page + 1} / {totalPages}
          </span>
          <button
            className="ft__pag-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            type="button"
          >
            »
          </button>
          <button
            className="ft__pag-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
            type="button"
          >
            »»
          </button>
        </div>
      )}
    </div>
  );
}
