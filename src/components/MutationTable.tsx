import { useState, useMemo, useCallback } from 'react';

// ---------- Types ----------

export interface MutationRow {
  id: string;
  name: string;
  multiplier: number;
  multiplierMin: number | null;
  category: string;
  appraisable: boolean | null;
  wikiNotes: string | null;
  obtainMethod: string | null;
}

interface Props {
  mutations: MutationRow[];
  categories: string[];
  maxMult: number;
}

// ---------- Constants ----------

const PAGE_SIZE = 50;

const CAT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  standard:      { bg: '#06d6a015', border: '#06d6a0', text: '#06d6a0' },
  limited:       { bg: '#ef444415', border: '#ef4444', text: '#f87171' },
  admin:         { bg: '#a855f715', border: '#a855f7', text: '#c084fc' },
  attribute:     { bg: '#0ea5e915', border: '#0ea5e9', text: '#38bdf8' },
  unobtainable:  { bg: '#71717a15', border: '#71717a', text: '#a1a1aa' },
};

type SortKey = 'multiplier' | 'name' | 'category';
type SortDir = 'asc' | 'desc';

// ---------- Component ----------

export default function MutationTable({ mutations, categories, maxMult }: Props) {
  const [search, setSearch] = useState('');
  const [selCat, setSelCat] = useState('');
  const [obtainableOnly, setObtainableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('multiplier');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelCat('');
    setObtainableOnly(false);
    setPage(0);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = mutations;

    if (q) list = list.filter(m => m.name.toLowerCase().includes(q));
    if (selCat) list = list.filter(m => m.category === selCat);
    if (obtainableOnly) list = list.filter(m => m.category !== 'unobtainable' && m.category !== 'admin');

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'multiplier': return dir * (a.multiplier - b.multiplier);
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'category': return dir * a.category.localeCompare(b.category);
        default: return 0;
      }
    });

    return list;
  }, [mutations, search, selCat, obtainableOnly, sortKey, sortDir]);

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

  const hasFilters = search || selCat || obtainableOnly;

  return (
    <div className="mt">
      {/* FILTERS */}
      <div className="mt__filters">
        <div className="mt__search-wrap">
          <svg className="mt__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input
            className="mt__search"
            type="text"
            placeholder="Search mutation..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
          />
        </div>

        <div className="mt__filter-row">
          <select
            className="mt__select"
            value={selCat}
            onChange={e => { setSelCat(e.target.value); setPage(0); }}
          >
            <option value="">All Categories</option>
            {categories.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>

          <label className="mt__toggle-label">
            <input
              type="checkbox"
              checked={obtainableOnly}
              onChange={e => { setObtainableOnly(e.target.checked); setPage(0); }}
            />
            <span>Obtainable only</span>
          </label>

          {hasFilters && (
            <button className="mt__clear" onClick={clearFilters} type="button">Clear</button>
          )}
        </div>
      </div>

      {/* COUNT */}
      <div className="mt__count">
        {filtered.length === mutations.length
          ? `${mutations.length} mutations`
          : `${filtered.length} of ${mutations.length} mutations`}
      </div>

      {/* LIST */}
      <div className="mt__list">
        {/* Header row */}
        <div className="mt__hdr-row">
          <span className="mt__hdr mt__hdr--name" onClick={() => handleSort('name')}>
            Name{sortIcon('name')}
          </span>
          <span className="mt__hdr mt__hdr--mult" onClick={() => handleSort('multiplier')}>
            Multiplier{sortIcon('multiplier')}
          </span>
          <span className="mt__hdr mt__hdr--cat" onClick={() => handleSort('category')}>
            Category{sortIcon('category')}
          </span>
          <span className="mt__hdr mt__hdr--appr">Appraisable</span>
        </div>

        {paginated.map(m => {
          const barPct = Math.min((m.multiplier / maxMult) * 100, 100);
          const cc = CAT_COLORS[m.category] || CAT_COLORS.standard;
          const isExpanded = expanded.has(m.id);
          const notes = m.wikiNotes || m.obtainMethod;

          return (
            <div key={m.id} className="mt__card">
              <div className="mt__card-main" onClick={() => notes && toggleExpand(m.id)}>
                <div className="mt__name-col">
                  <span className="mt__name">{m.name}</span>
                  {m.multiplierMin !== null && (
                    <span className="mt__range">{m.multiplierMin}× – {m.multiplier}×</span>
                  )}
                </div>

                <div className="mt__mult-col">
                  <span className="mt__mult-val">{m.multiplier}×</span>
                  <div className="mt__bar">
                    <div
                      className="mt__bar-fill"
                      style={{
                        width: `${barPct}%`,
                        background: barPct > 70 ? '#f43f5e' : barPct > 40 ? '#f59e0b' : '#06d6a0',
                      }}
                    />
                  </div>
                </div>

                <span
                  className="mt__cat-badge"
                  style={{ background: cc.bg, borderColor: cc.border, color: cc.text }}
                >
                  {m.category}
                </span>

                <span className="mt__appr">
                  {m.appraisable === true ? (
                    <span className="mt__appr-yes">Yes</span>
                  ) : m.appraisable === false ? (
                    <span className="mt__appr-no">No</span>
                  ) : (
                    <span className="mt__appr-unk">—</span>
                  )}
                </span>

                {notes && (
                  <svg
                    className={`mt__chevron ${isExpanded ? 'mt__chevron--open' : ''}`}
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                )}
              </div>

              {isExpanded && notes && (
                <div className="mt__notes">
                  {notes}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="mt__empty">
          No mutations match your filters.
          <button className="mt__clear" onClick={clearFilters} type="button">Clear filters</button>
        </div>
      )}

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="mt__pag">
          <button className="mt__pag-btn" disabled={page === 0} onClick={() => setPage(0)} type="button">««</button>
          <button className="mt__pag-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)} type="button">«</button>
          <span className="mt__pag-info">{page + 1} / {totalPages}</span>
          <button className="mt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} type="button">»</button>
          <button className="mt__pag-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} type="button">»»</button>
        </div>
      )}
    </div>
  );
}
