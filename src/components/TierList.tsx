import { useState, useMemo } from 'react';

/* ================================================================
   Types
   ================================================================ */

export interface TierItem {
  name: string;
  slug: string;
  tradeValue: number | null;
  demand: string | null;
  trend: string | null;
  rarity: string | null;
  imageUrl: string | null;
}

interface Props {
  items: TierItem[];
  sources: string[];
  basePath: string; // e.g. "/games/fisch/boats"
}

/* ================================================================
   Constants
   ================================================================ */

const SOURCE_COLORS: Record<string, string> = {
  Limited: '#ef4444', Robux: '#22c55e', Regular: '#3b82f6', Code: '#f59e0b',
  Egg: '#ec4899', Merch: '#a855f7', 'Pirate Faction': '#f97316', Challenge: '#06b6d4',
  'Friend Quest': '#8b5cf6', DLC: '#14b8a6', Event: '#f43f5e', Exclusive: '#fbbf24',
  'Skin Merchant': '#c084fc',
};

interface TierDef {
  id: string;
  label: string;
  desc: string;
  color: string;
  bg: string;
}

const TIERS: TierDef[] = [
  { id: 'SS', label: 'SS', desc: 'Most Valuable', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  { id: 'S',  label: 'S',  desc: 'Top Tier',      color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  { id: 'A',  label: 'A',  desc: 'High Value',    color: '#f97316', bg: 'rgba(249,115,22,0.10)' },
  { id: 'B',  label: 'B',  desc: 'Good Value',    color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  { id: 'C',  label: 'C',  desc: 'Average',       color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
  { id: 'D',  label: 'D',  desc: 'Low Value',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
];

/* ================================================================
   Helpers
   ================================================================ */

function assignTiers(items: TierItem[]): Map<string, TierDef> {
  const sorted = [...items]
    .filter(i => i.tradeValue != null && i.tradeValue > 0)
    .sort((a, b) => (b.tradeValue || 0) - (a.tradeValue || 0));

  const total = sorted.length;
  const map = new Map<string, TierDef>();

  sorted.forEach((item, idx) => {
    const pct = idx / total;
    let tier: TierDef;
    if (pct < 0.03)      tier = TIERS[0]; // SS
    else if (pct < 0.10) tier = TIERS[1]; // S
    else if (pct < 0.25) tier = TIERS[2]; // A
    else if (pct < 0.50) tier = TIERS[3]; // B
    else if (pct < 0.75) tier = TIERS[4]; // C
    else                 tier = TIERS[5]; // D
    map.set(item.slug, tier);
  });

  // Items without tradeValue → D tier
  items.forEach(item => {
    if (!map.has(item.slug)) map.set(item.slug, TIERS[5]);
  });

  return map;
}

function fmtValue(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/* ================================================================
   Component
   ================================================================ */

export default function TierList({ items, sources, basePath }: Props) {
  const [search, setSearch] = useState('');
  const [selSources, setSelSources] = useState<Set<string>>(new Set());

  const tierMap = useMemo(() => assignTiers(items), [items]);

  const grouped = useMemo(() => {
    let list = items;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (selSources.size > 0) {
      list = list.filter(i => selSources.has(i.rarity || ''));
    }

    // Group by tier
    const groups: Record<string, TierItem[]> = {};
    TIERS.forEach(t => { groups[t.id] = []; });

    list.forEach(item => {
      const tier = tierMap.get(item.slug) || TIERS[5];
      groups[tier.id].push(item);
    });

    // Sort within each tier by value descending
    Object.values(groups).forEach(arr =>
      arr.sort((a, b) => (b.tradeValue || 0) - (a.tradeValue || 0))
    );

    return groups;
  }, [items, search, selSources, tierMap]);

  const totalFiltered = Object.values(grouped).reduce((s, arr) => s + arr.length, 0);

  const toggleSource = (s: string) => {
    setSelSources(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  return (
    <div className="tl">
      {/* Filters */}
      <div className="tl__filters">
        <div className="tl__search-wrap">
          <svg className="tl__search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            className="tl__search"
            type="text"
            placeholder="Search items..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="tl__filter-row">
          {sources.map(s => (
            <button
              key={s}
              className={`tl__src-btn${selSources.has(s) ? ' tl__src-btn--on' : ''}`}
              style={{ '--src-color': SOURCE_COLORS[s] || '#888' } as any}
              onClick={() => toggleSource(s)}
              type="button"
            >
              {s}
            </button>
          ))}
          {selSources.size > 0 && (
            <button className="tl__clear" onClick={() => setSelSources(new Set())} type="button">
              Clear
            </button>
          )}
        </div>
      </div>

      <p className="tl__count">{totalFiltered} items</p>

      {/* Tier Rows */}
      <div className="tl__tiers">
        {TIERS.map(tier => {
          const tierItems = grouped[tier.id];
          if (tierItems.length === 0) return null;

          return (
            <div key={tier.id} className="tl__tier" style={{ '--tier-color': tier.color, '--tier-bg': tier.bg } as any}>
              <div className="tl__tier-label">
                <span className="tl__tier-id">{tier.label}</span>
                <span className="tl__tier-desc">{tier.desc}</span>
                <span className="tl__tier-count">{tierItems.length}</span>
              </div>
              <div className="tl__tier-items">
                {tierItems.map(item => (
                  <a
                    key={item.slug}
                    href={`${basePath}/${item.slug}/`}
                    className="tl__item"
                    title={`${item.name} — ${fmtValue(item.tradeValue)} ER`}
                  >
                    <div className="tl__item-img">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.name} loading="lazy" width="80" height="80" />
                      ) : (
                        <span className="tl__item-ph">?</span>
                      )}
                    </div>
                    <div className="tl__item-info">
                      <span className="tl__item-name">{item.name}</span>
                      <span className="tl__item-val">{fmtValue(item.tradeValue)} ER</span>
                      {item.rarity && (
                        <span
                          className="tl__item-rarity"
                          style={{ '--badge-color': SOURCE_COLORS[item.rarity] || '#888' } as any}
                        >
                          {item.rarity}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {totalFiltered === 0 && (
        <div className="tl__empty">
          <span style={{ fontSize: '2rem' }}>🔍</span>
          <p>No items match your filters</p>
        </div>
      )}
    </div>
  );
}
