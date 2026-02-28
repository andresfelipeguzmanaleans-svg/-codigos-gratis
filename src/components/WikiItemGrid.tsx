import { useState, useMemo } from 'react';

// ---------- Types ----------

export interface WikiItem {
  name: string;
  slug: string;
  badge: string;
  badgeColor: string;
  subtitle: string;
  imageUrl?: string | null;
}

interface Props {
  items: WikiItem[];
  filters: string[];
  filterColors: Record<string, string>;
  basePath: string;
  placeholder?: string;
}

// ---------- Component ----------

export default function WikiItemGrid({
  items,
  filters,
  filterColors,
  basePath,
  placeholder = 'Search…',
}: Props) {
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [sortAlpha, setSortAlpha] = useState(false);

  const toggleFilter = (f: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let list = items;

    if (query) {
      const q = query.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }

    if (activeFilters.size > 0) {
      list = list.filter(i => activeFilters.has(i.badge));
    }

    if (sortAlpha) {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [items, query, activeFilters, sortAlpha]);

  return (
    <>
      {/* Filters */}
      <div className="tig__filters">
        <div className="tig__search-wrap">
          <svg className="tig__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="tig__search"
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div className="tig__filter-row">
          <button
            className={`tig__sort-btn${!sortAlpha ? ' tig__sort-btn--active' : ''}`}
            onClick={() => setSortAlpha(false)}
          >Default</button>
          <button
            className={`tig__sort-btn${sortAlpha ? ' tig__sort-btn--active' : ''}`}
            onClick={() => setSortAlpha(true)}
          >A → Z</button>

          <span className="tig__divider" />

          {filters.map(f => {
            const color = filterColors[f] || '#6b7280';
            const active = activeFilters.has(f);
            return (
              <button
                key={f}
                className={`tig__src-btn${active ? ' tig__src-btn--active' : ''}`}
                style={{ '--src-color': color } as React.CSSProperties}
                onClick={() => toggleFilter(f)}
              >{f}</button>
            );
          })}

          {activeFilters.size > 0 && (
            <button className="tig__clear" onClick={() => setActiveFilters(new Set())}>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Count */}
      <div className="tig__count">
        {filtered.length} item{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="tig__empty">
          <span style={{ fontSize: '2rem' }}>🔍</span>
          <span>No items match your search</span>
        </div>
      ) : (
        <div className="tig__grid">
          {filtered.map(item => {
            const color = item.badgeColor || '#6b7280';
            return (
              <a
                key={item.slug}
                href={`${basePath}/${item.slug}/`}
                className="tig__card"
                style={{ '--card-accent': color } as React.CSSProperties}
              >
                <div className="tig__card-img">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} loading="lazy" width="120" height="120" />
                  ) : (
                    <div className="tig__card-ph">✨</div>
                  )}
                </div>
                <div className="tig__card-body">
                  <h3 className="tig__card-name">{item.name}</h3>
                  <div className="tig__card-badges">
                    <span
                      className="tig__badge"
                      style={{ '--badge-color': color } as React.CSSProperties}
                    >{item.badge}</span>
                  </div>
                  {item.subtitle && (
                    <p className="tig__card-sub">{item.subtitle}</p>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
