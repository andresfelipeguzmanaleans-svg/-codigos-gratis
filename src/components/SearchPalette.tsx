import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

// ---------- Types ----------

export interface SearchItem {
  /** Unique id */
  i: string;
  /** Display name */
  n: string;
  /** Type: f=fish, m=mutation, r=rod, l=location, s=rod skin, b=boat */
  t: 'f' | 'm' | 'r' | 'l' | 's' | 'b';
  /** Extra info (rarity for fish, category for mutations, etc.) */
  x?: string;
}

interface Props {
  items: SearchItem[];
  gameSlug: string;
}

// ---------- Constants ----------

const TYPE_META: Record<string, { label: string; icon: string; max: number }> = {
  f: { label: 'Fish', icon: '🐟', max: 6 },
  s: { label: 'Rod Skins', icon: '🎨', max: 4 },
  b: { label: 'Boats', icon: '🚤', max: 4 },
  m: { label: 'Mutations', icon: '🧬', max: 4 },
  r: { label: 'Rods', icon: '🎣', max: 4 },
  l: { label: 'Locations', icon: '📍', max: 4 },
};

const TYPE_ORDER = ['f', 's', 'b', 'm', 'r', 'l'] as const;

function getHref(item: SearchItem, gameSlug: string): string {
  switch (item.t) {
    case 'f': return `/games/${gameSlug}/fish/${item.i}/`;
    case 'm': return `/games/${gameSlug}/mutations/`;
    case 'r': return `/games/${gameSlug}/rods/`;
    case 'l': return `/games/${gameSlug}/locations/`;
    case 's': return `/games/${gameSlug}/rod-skins/${item.i}/`;
    case 'b': return `/games/${gameSlug}/boats/${item.i}/`;
  }
}

// ---------- Component ----------

export default function SearchPalette({ items, gameSlug }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open/close
  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery('');
    setActiveIdx(0);
  }, []);

  const closePalette = useCallback(() => setOpen(false), []);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      }
      if (e.key === 'Escape' && open) {
        closePalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, openPalette, closePalette]);

  // Custom event from topbar button
  useEffect(() => {
    const handler = () => openPalette();
    window.addEventListener('open-search', handler);
    return () => window.removeEventListener('open-search', handler);
  }, [openPalette]);

  // Auto-focus input
  useEffect(() => {
    if (open && inputRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Filter results
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const result: { type: string; meta: typeof TYPE_META[string]; items: SearchItem[] }[] = [];

    for (const t of TYPE_ORDER) {
      const meta = TYPE_META[t];
      const matches = items
        .filter(item => item.t === t && item.n.toLowerCase().includes(q))
        .slice(0, meta.max);
      if (matches.length > 0) {
        result.push({ type: t, meta, items: matches });
      }
    }

    return result;
  }, [items, query]);

  // Flat list for keyboard nav
  const flatItems = useMemo(() => {
    const flat: SearchItem[] = [];
    for (const g of groups) {
      for (const item of g.items) flat.push(item);
    }
    return flat;
  }, [groups]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % Math.max(flatItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1));
    } else if (e.key === 'Enter' && flatItems[activeIdx]) {
      e.preventDefault();
      window.location.href = getHref(flatItems[activeIdx], gameSlug);
    }
  }, [flatItems, activeIdx, gameSlug]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector('[data-active="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  let flatIdx = 0;

  return (
    <div className="sp__overlay" onClick={closePalette}>
      <div className="sp__modal" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="sp__input-wrap">
          <svg className="sp__input-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            className="sp__input"
            type="text"
            placeholder="Search fish, mutations, rods, locations..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="sp__kbd">ESC</kbd>
        </div>

        {/* Results */}
        <div className="sp__results" ref={listRef}>
          {query.trim() === '' && (
            <div className="sp__hint">Start typing to search across all Fisch data...</div>
          )}
          {query.trim() !== '' && groups.length === 0 && (
            <div className="sp__empty">No results for &ldquo;{query}&rdquo;</div>
          )}
          {groups.map(group => {
            return (
              <div key={group.type} className="sp__group">
                <div className="sp__group-header">
                  <span className="sp__group-icon">{group.meta.icon}</span>
                  <span className="sp__group-label">{group.meta.label}</span>
                </div>
                {group.items.map(item => {
                  const idx = flatIdx++;
                  const isActive = idx === activeIdx;
                  return (
                    <a
                      key={item.i + item.t}
                      href={getHref(item, gameSlug)}
                      className={'sp__item' + (isActive ? ' sp__item--active' : '')}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIdx(idx)}
                    >
                      <span className="sp__item-name">{item.n}</span>
                      {item.x && <span className="sp__item-extra">{item.x}</span>}
                      <svg className="sp__item-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="sp__footer">
          <span className="sp__footer-hint">
            <kbd className="sp__kbd sp__kbd--sm">&uarr;</kbd>
            <kbd className="sp__kbd sp__kbd--sm">&darr;</kbd>
            to navigate
          </span>
          <span className="sp__footer-hint">
            <kbd className="sp__kbd sp__kbd--sm">Enter</kbd>
            to select
          </span>
          <span className="sp__footer-hint">
            <kbd className="sp__kbd sp__kbd--sm">Esc</kbd>
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
