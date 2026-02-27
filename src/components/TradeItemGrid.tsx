import { useState, useMemo } from 'react';

export interface TradeItem {
  name: string;
  slug: string;
  tradeValue: number | null;
  demand: string | null;
  trend: string | null;
  rarity: string | null;
  imageUrl: string | null;
  itemType?: string; // 'rod_skin' | 'boat' — used to derive per-item URLs on combined pages
}

interface Props {
  items: TradeItem[];
  sources: string[];
  basePath: string; // e.g. "/games/fisch/rod-skins"
}

const SOURCE_COLORS: Record<string, string> = {
  Limited: '#ef4444',
  Robux: '#22c55e',
  Regular: '#3b82f6',
  Code: '#f59e0b',
  Egg: '#ec4899',
  Merch: '#a855f7',
  'Pirate Faction': '#f97316',
  Challenge: '#06b6d4',
  'Friend Quest': '#8b5cf6',
  DLC: '#14b8a6',
  Event: '#f43f5e',
  Exclusive: '#fbbf24',
  'Skin Merchant': '#c084fc',
};

const DEMAND_COLORS: Record<string, string> = {
  'Very High': '#ef4444',
  High: '#f59e0b',
  Medium: '#22c55e',
  Low: '#3b82f6',
  'Very Low': '#6b7280',
};

const TREND_COLORS: Record<string, string> = {
  Stable: '#22c55e',
  Unstable: '#f59e0b',
};

function fmtValue(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

export default function TradeItemGrid({ items, sources, basePath }: Props) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'value' | 'name'>('value');
  const [selSources, setSelSources] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let list = items;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (selSources.size > 0) {
      list = list.filter(i => selSources.has(i.rarity || ''));
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'value') return (b.tradeValue || 0) - (a.tradeValue || 0);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [items, search, sortBy, selSources]);

  const toggleSource = (s: string) => {
    setSelSources(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <div>
      {/* Filters */}
      <div className="tig__filters">
        <div className="tig__search-wrap">
          <svg className="tig__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input className="tig__search" type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="tig__filter-row">
          <button className={`tig__sort-btn ${sortBy === 'value' ? 'tig__sort-btn--active' : ''}`} onClick={() => setSortBy('value')}>Value ↓</button>
          <button className={`tig__sort-btn ${sortBy === 'name' ? 'tig__sort-btn--active' : ''}`} onClick={() => setSortBy('name')}>A-Z</button>
          <span className="tig__divider" />
          {sources.map(s => (
            <button key={s} className={`tig__src-btn ${selSources.has(s) ? 'tig__src-btn--active' : ''}`} style={{ '--src-color': SOURCE_COLORS[s] || '#888' } as any} onClick={() => toggleSource(s)}>
              {s}
            </button>
          ))}
          {selSources.size > 0 && <button className="tig__clear" onClick={() => setSelSources(new Set())}>Clear</button>}
        </div>
      </div>

      <p className="tig__count">{filtered.length} items</p>

      {/* Grid */}
      <div className="tig__grid">
        {filtered.map(item => {
          const bgColor = SOURCE_COLORS[item.rarity || ''] || '#3b82f6';
          const itemPath = item.itemType === 'boat' ? '/games/fisch/boats'
            : item.itemType === 'rod_skin' ? '/games/fisch/rod-skins'
            : basePath;
          return (
            <a key={item.slug} href={`${itemPath}/${item.slug}/`} className="tig__card" style={{ '--card-accent': bgColor } as any}>
              <div className="tig__card-img">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} loading="lazy" width="200" height="200" />
                ) : (
                  <div className="tig__card-ph">?</div>
                )}
              </div>
              <div className="tig__card-body">
                <h3 className="tig__card-name">{item.name}</h3>
                <div className="tig__card-value">{fmtValue(item.tradeValue)} ER</div>
                <div className="tig__card-badges">
                  {item.demand && (
                    <span className="tig__badge" style={{ '--badge-color': DEMAND_COLORS[item.demand] || '#888' } as any}>
                      {item.demand}
                    </span>
                  )}
                  {item.trend && (
                    <span className="tig__badge" style={{ '--badge-color': TREND_COLORS[item.trend] || '#888' } as any}>
                      {item.trend}
                    </span>
                  )}
                  {item.rarity && (
                    <span className="tig__badge tig__badge--src" style={{ '--badge-color': SOURCE_COLORS[item.rarity] || '#888' } as any}>
                      {item.rarity}
                    </span>
                  )}
                </div>
              </div>
            </a>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="tig__empty">
          <span style={{ fontSize: '2rem' }}>🔍</span>
          <p>No items match your filters</p>
        </div>
      )}
    </div>
  );
}
