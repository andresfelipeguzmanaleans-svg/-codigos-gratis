import { useState, useMemo, useCallback } from 'react';

// ---------- Types ----------

export interface RodRow {
  id: string;
  name: string;
  luckBonus: number;
  control: number;
  resilience: number;
  lureSpeed: number;
  obtainMethod: string | null;
  isCosmetic: boolean;
}

interface Props {
  rods: RodRow[];
  maxLuck: number;
  maxControl: number;
  maxResil: number;
  maxLure: number;
}

// ---------- Constants ----------

type SortKey = 'name' | 'luck' | 'control' | 'resilience' | 'lure';
type SortDir = 'asc' | 'desc';

// ---------- Helpers ----------

function barPct(val: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min((val / max) * 100, 100));
}

function barColor(pct: number): string {
  if (pct >= 80) return '#06d6a0';
  if (pct >= 50) return '#0ea5e9';
  if (pct >= 25) return '#f59e0b';
  return '#71717a';
}

function fmtStat(val: number, isControl: boolean): string {
  if (isControl) return val.toFixed(2);
  return val.toLocaleString('en-US');
}

// ---------- Component ----------

export default function RodTable({ rods, maxLuck, maxControl, maxResil, maxLure }: Props) {
  const [search, setSearch] = useState('');
  const [hideCosmetic, setHideCosmetic] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('luck');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = rods;

    if (q) list = list.filter(r => r.name.toLowerCase().includes(q));
    if (hideCosmetic) list = list.filter(r => !r.isCosmetic);

    const dir = sortDir === 'asc' ? 1 : -1;
    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name': return dir * a.name.localeCompare(b.name);
        case 'luck': return dir * (a.luckBonus - b.luckBonus);
        case 'control': return dir * (a.control - b.control);
        case 'resilience': return dir * (a.resilience - b.resilience);
        case 'lure': return dir * (a.lureSpeed - b.lureSpeed);
        default: return 0;
      }
    });

    return list;
  }, [rods, search, hideCosmetic, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const hasFilters = search || hideCosmetic;

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
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="rt__filter-row">
          <label className="rt__toggle-label">
            <input
              type="checkbox"
              checked={hideCosmetic}
              onChange={e => setHideCosmetic(e.target.checked)}
            />
            <span>Hide cosmetic rods</span>
          </label>
          {hasFilters && (
            <button className="rt__clear" onClick={() => { setSearch(''); setHideCosmetic(false); }} type="button">Clear</button>
          )}
        </div>
      </div>

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
              <th className="rt__th rt__th--name" onClick={() => handleSort('name')}>
                Name{sortIcon('name')}
              </th>
              <th className="rt__th rt__th--stat" onClick={() => handleSort('luck')}>
                Luck{sortIcon('luck')}
              </th>
              <th className="rt__th rt__th--stat" onClick={() => handleSort('control')}>
                Control{sortIcon('control')}
              </th>
              <th className="rt__th rt__th--stat rt__th--hide-sm" onClick={() => handleSort('resilience')}>
                Resilience{sortIcon('resilience')}
              </th>
              <th className="rt__th rt__th--stat rt__th--hide-sm" onClick={() => handleSort('lure')}>
                Lure Spd{sortIcon('lure')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isOpen = expanded.has(r.id);
              const luckPct = barPct(r.luckBonus, maxLuck);
              const ctrlPct = barPct(r.control, maxControl);
              // For resilience, ignore the -999999999 outlier
              const resilPct = r.resilience < 0 ? 0 : barPct(r.resilience, maxResil);
              const lurePct = barPct(r.lureSpeed, maxLure);

              return (
                <tr
                  key={r.id}
                  className={`rt__row ${r.isCosmetic ? 'rt__row--cosmetic' : ''}`}
                  onClick={() => toggleExpand(r.id)}
                >
                  <td className="rt__td rt__td--name">
                    <div className="rt__name-wrap">
                      <span className="rt__name-text">{r.name}</span>
                      {r.isCosmetic && <span className="rt__cosmetic-tag">Cosmetic</span>}
                    </div>
                    {isOpen && r.obtainMethod && (
                      <div className="rt__obtain">{r.obtainMethod}</div>
                    )}
                  </td>
                  <td className="rt__td rt__td--stat">
                    <div className="rt__stat-cell">
                      <span className="rt__stat-num">{r.luckBonus}</span>
                      <div className="rt__stat-bar">
                        <div className="rt__stat-fill" style={{ width: `${luckPct}%`, background: barColor(luckPct) }} />
                      </div>
                    </div>
                  </td>
                  <td className="rt__td rt__td--stat">
                    <div className="rt__stat-cell">
                      <span className="rt__stat-num">{fmtStat(r.control, true)}</span>
                      <div className="rt__stat-bar">
                        <div className="rt__stat-fill" style={{ width: `${ctrlPct}%`, background: barColor(ctrlPct) }} />
                      </div>
                    </div>
                  </td>
                  <td className="rt__td rt__td--stat rt__td--hide-sm">
                    <div className="rt__stat-cell">
                      <span className="rt__stat-num">{r.resilience.toLocaleString('en-US')}</span>
                      <div className="rt__stat-bar">
                        <div className="rt__stat-fill" style={{ width: `${resilPct}%`, background: barColor(resilPct) }} />
                      </div>
                    </div>
                  </td>
                  <td className="rt__td rt__td--stat rt__td--hide-sm">
                    <div className="rt__stat-cell">
                      <span className="rt__stat-num">{r.lureSpeed}</span>
                      <div className="rt__stat-bar">
                        <div className="rt__stat-fill" style={{ width: `${lurePct}%`, background: barColor(lurePct) }} />
                      </div>
                    </div>
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
          <button className="rt__clear" onClick={() => { setSearch(''); setHideCosmetic(false); }} type="button">Clear filters</button>
        </div>
      )}
    </div>
  );
}
