import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

// ---------- Types ----------

export interface RodRow {
  id: string;
  name: string;
  stage: number | null;
  luckBonus: number;
  control: number;
  resilience: number;
  lureSpeed: number;
  obtainedFrom: string | null;
  passive: string | null;
  price: string | null;
  isCosmetic: boolean;
  imageUrl: string | null;
}

interface Props {
  rods: RodRow[];
  stages: number[];
  locations: string[];
}

// ---------- Constants ----------

const PAGE_SIZE = 50;

const STAGE_COLORS: Record<number, string> = {
  1: '#6b7280', 2: '#3b82f6', 3: '#22c55e', 4: '#f59e0b',
  5: '#ef4444', 6: '#8b5cf6', 7: '#ec4899', 8: '#14b8a6',
  9: '#f97316', 10: '#06b6d4', 11: '#fbbf24', 12: '#e11d48',
};

type SortKey = 'name' | 'stage' | 'luck' | 'control' | 'resilience' | 'lure';
type SortDir = 'asc' | 'desc';

// ---------- Component ----------

export default function RodTable({ rods, stages, locations }: Props) {
  const [search, setSearch] = useState('');
  const [selStages, setSelStages] = useState<Set<number>>(new Set());
  const [selLocation, setSelLocation] = useState('');
  const [hideCosmetic, setHideCosmetic] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('luck');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [showStagePanel, setShowStagePanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowStagePanel(false);
      }
    }
    if (showStagePanel) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showStagePanel]);

  const toggleStage = useCallback((s: number) => {
    setSelStages(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelStages(new Set());
    setSelLocation('');
    setHideCosmetic(false);
    setPage(0);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = rods;

    if (q) list = list.filter(r => r.name.toLowerCase().includes(q));
    if (selStages.size > 0) list = list.filter(r => r.stage != null && selStages.has(r.stage));
    if (selLocation) list = list.filter(r => r.obtainedFrom === selLocation);
    if (hideCosmetic) list = list.filter(r => r.isCosmetic === false);

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'stage': return dir * ((a.stage ?? 0) - (b.stage ?? 0));
        case 'luck': return dir * (a.luckBonus - b.luckBonus);
        case 'control': return dir * (a.control - b.control);
        case 'resilience': return dir * (a.resilience - b.resilience);
        case 'lure': return dir * (a.lureSpeed - b.lureSpeed);
        default: return 0;
      }
    });

    return list;
  }, [rods, search, selStages, selLocation, hideCosmetic, sortKey, sortDir]);

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
    if (sortKey !== key) return ' \u2195';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  const hasFilters = search || selStages.size > 0 || selLocation || hideCosmetic;

  const stageClr = (s: number | null) => STAGE_COLORS[s || 0] || '#6b7280';

  return (
    <div className="rt">
      {/* FILTERS */}
      <div className="rt__filters">
        <div className="rt__search-wrap">
          <svg className="rt__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            className="rt__search"
            type="text"
            placeholder="Search rod..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <div className="rt__filter-row">
          {/* Stage multi-select */}
          <div className="rt__stage-wrap" ref={panelRef}>
            <button
              className="rt__filter-btn"
              onClick={() => setShowStagePanel(!showStagePanel)}
              type="button"
            >
              Stage{selStages.size > 0 ? ` (${selStages.size})` : ''}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {showStagePanel && (
              <div className="rt__stage-panel">
                {stages.map(s => (
                  <label key={s} className="rt__stage-opt">
                    <input
                      type="checkbox"
                      checked={selStages.has(s)}
                      onChange={() => toggleStage(s)}
                    />
                    <span
                      className="rt__stage-dot"
                      style={{ background: STAGE_COLORS[s] || '#888' }}
                    />
                    <span>Stage {s}</span>
                    <span className="rt__stage-cnt">
                      {rods.filter(r => r.stage === s).length}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Location */}
          <select
            className="rt__select"
            value={selLocation}
            onChange={e => { setSelLocation(e.target.value); setPage(0); }}
          >
            <option value="">All Locations</option>
            {locations.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {/* Hide cosmetic */}
          <label className="rt__cosmetic-label">
            <input
              type="checkbox"
              checked={hideCosmetic}
              onChange={e => { setHideCosmetic(e.target.checked); setPage(0); }}
            />
            <span>Hide cosmetic</span>
          </label>

          {hasFilters && (
            <button className="rt__clear" onClick={clearFilters} type="button">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* COUNT */}
      <div className="rt__count">
        {filtered.length === rods.length
          ? `${rods.length} rods`
          : `${filtered.length} of ${rods.length} rods`}
      </div>

      {/* TABLE */}
      <div className="rt__table-wrap">
        <table className="rt__table">
          <thead>
            <tr>
              <th className="rt__th rt__th--img"></th>
              <th className="rt__th rt__th--name" onClick={() => handleSort('name')}>
                Name{sortIcon('name')}
              </th>
              <th className="rt__th rt__th--stage" onClick={() => handleSort('stage')}>
                Stage{sortIcon('stage')}
              </th>
              <th className="rt__th rt__th--stat" onClick={() => handleSort('luck')}>
                Luck{sortIcon('luck')}
              </th>
              <th className="rt__th rt__th--stat rt__th--hide-sm" onClick={() => handleSort('control')}>
                Control{sortIcon('control')}
              </th>
              <th className="rt__th rt__th--stat rt__th--hide-sm" onClick={() => handleSort('resilience')}>
                Resil.{sortIcon('resilience')}
              </th>
              <th className="rt__th rt__th--stat rt__th--hide-sm" onClick={() => handleSort('lure')}>
                Lure{sortIcon('lure')}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.map(r => {
              const clr = stageClr(r.stage);
              return (
                <tr
                  key={r.id}
                  className={`rt__row${r.isCosmetic ? ' rt__row--cosmetic' : ''}`}
                  style={{ borderLeft: `3px solid ${clr}` }}
                  onClick={() => { window.location.href = `/games/fisch/rods/${r.id}/`; }}
                >
                  <td className="rt__td rt__td--img">
                    {r.imageUrl ? (
                      <img
                        className="rt__thumb"
                        src={r.imageUrl}
                        alt=""
                        width="32"
                        height="32"
                        loading="lazy"
                        onError={(e: any) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div className="rt__thumb-ph" style={{ background: clr + '15' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3, color: clr }}>
                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                        </svg>
                      </div>
                    )}
                  </td>
                  <td className="rt__td rt__td--name">
                    <a href={`/games/fisch/rods/${r.id}/`} className="rt__name-link" onClick={e => e.stopPropagation()}>
                      {r.name}
                    </a>
                    {r.isCosmetic && <span className="rt__cosmetic-tag">Cosmetic</span>}
                  </td>
                  <td className="rt__td rt__td--stage">
                    {r.stage ? (
                      <span
                        className="rt__badge"
                        style={{
                          color: clr,
                          borderColor: clr + '40',
                          background: clr + '15',
                        }}
                      >
                        Stage {r.stage}
                      </span>
                    ) : '\u2014'}
                  </td>
                  <td className="rt__td rt__td--stat">
                    <span className="rt__luck-val">{r.luckBonus.toLocaleString('en-US')}</span>
                  </td>
                  <td className="rt__td rt__td--stat rt__td--hide-sm">
                    {r.control.toFixed(2)}
                  </td>
                  <td className="rt__td rt__td--stat rt__td--hide-sm">
                    {r.resilience > -1_000_000 ? r.resilience.toLocaleString('en-US') : '\u2014'}
                  </td>
                  <td className="rt__td rt__td--stat rt__td--hide-sm">
                    {r.lureSpeed.toLocaleString('en-US')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="rt__empty">
          No rods match your filters.
          <button className="rt__clear" onClick={clearFilters} type="button">Clear filters</button>
        </div>
      )}

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="rt__pag">
          <button className="rt__pag-btn" disabled={page === 0} onClick={() => setPage(0)} type="button">&laquo;&laquo;</button>
          <button className="rt__pag-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)} type="button">&laquo;</button>
          <span className="rt__pag-info">{page + 1} / {totalPages}</span>
          <button className="rt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} type="button">&raquo;</button>
          <button className="rt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} type="button">&raquo;&raquo;</button>
        </div>
      )}
    </div>
  );
}
