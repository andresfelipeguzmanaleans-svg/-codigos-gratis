import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

/* ================================================================
   Types
   ================================================================ */

export interface SlimFish {
  id: string;
  name: string;
  rarity: string;
  baseValue: number;
  baseWeight: number;
  weightMin: number;
  weightMax: number;
  imageUrl?: string | null;
}

export interface SlimMutation {
  id: string;
  name: string;
  multiplier: number;
  category: string;
}

export interface TradeItem {
  id: string;
  name: string;
  rarity: string;
  value: number;
  imageUrl?: string | null;
  itemType: 'boat' | 'rod_skin';
}

interface Props {
  fish: SlimFish[];
  mutations: SlimMutation[];
  tradeItems: TradeItem[];
}

type Category = 'all' | 'fish' | 'boat' | 'rod_skin';

interface TradeEntry {
  key: number;
  type: 'fish' | 'item';
  // fish fields
  fishId: string;
  weight: string;
  mutationId: string;
  // item fields
  itemId: string;
  qty: number;
}

interface HistoryEntry {
  offerTotal: number;
  requestTotal: number;
  verdict: 'PROFIT' | 'BALANCED' | 'OVERPAY';
  diff: number;
  ts: number;
}

/* ================================================================
   Constants
   ================================================================ */

const RARITY_COLORS: Record<string, string> = {
  Trash: '#71717a', Common: '#9ca3af', Uncommon: '#22c55e', Unusual: '#34d39e',
  Rare: '#3b82f6', Legendary: '#f59e0b', Mythical: '#a855f7', Exotic: '#ec4899',
  Limited: '#ef4444', Special: '#06b6d4', Secret: '#fbbf24', 'Divine Secret': '#fde68a',
  Apex: '#f43f5e', Extinct: '#a8a29e', Relic: '#c084fc', Gemstone: '#2dd4bf',
  Fragment: '#67e8f9', Regular: '#3b82f6', Robux: '#22c55e', Code: '#f59e0b',
  Egg: '#ec4899', Merch: '#a855f7', DLC: '#14b8a6', Event: '#f43f5e',
  Exclusive: '#fbbf24', Challenge: '#06b6d4', 'Pirate Faction': '#f97316',
  'Friend Quest': '#8b5cf6', 'Skin Merchant': '#c084fc',
};

const RARITY_GRADIENTS: Record<string, string> = {
  Limited: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(249,115,22,0.08))',
  Robux: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(6,182,212,0.08))',
  Exclusive: 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(236,72,153,0.08))',
  Legendary: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(234,179,8,0.08))',
  Mythical: 'linear-gradient(135deg, rgba(168,85,247,0.15), rgba(139,92,246,0.08))',
  'Divine Secret': 'linear-gradient(135deg, rgba(253,230,138,0.15), rgba(251,191,36,0.08))',
};

function fmt(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/* ================================================================
   Entry value calculation
   ================================================================ */

function calcValue(
  entry: TradeEntry,
  fishMap: Map<string, SlimFish>,
  itemMap: Map<string, TradeItem>,
  mutations: SlimMutation[],
): number {
  if (entry.type === 'item') {
    const item = itemMap.get(entry.itemId);
    return item ? item.value * entry.qty : 0;
  }
  // fish
  if (!entry.fishId) return 0;
  const f = fishMap.get(entry.fishId);
  if (!f) return 0;
  const w = parseFloat(entry.weight) || 0;
  if (w <= 0) return 0;
  const mut = mutations.find(m => m.id === entry.mutationId);
  return f.baseValue * w * (mut ? mut.multiplier : 1);
}

function makeEntry(key: number): TradeEntry {
  return { key, type: 'fish', fishId: '', weight: '', mutationId: 'none', itemId: '', qty: 1 };
}

/* ================================================================
   Unified Item Picker
   ================================================================ */

interface PickerProps {
  fish: SlimFish[];
  tradeItems: TradeItem[];
  onSelectFish: (id: string) => void;
  onSelectItem: (id: string) => void;
  selectedFishId: string;
  selectedItemId: string;
  entryType: 'fish' | 'item';
}

function ItemPicker({ fish, tradeItems, onSelectFish, onSelectItem, selectedFishId, selectedItemId, entryType }: PickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<Category>('all');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Build unified list
  const allItems = useMemo(() => {
    const items: { id: string; name: string; rarity: string; value: number; unit: string; type: 'fish' | 'boat' | 'rod_skin'; imageUrl?: string | null }[] = [];
    fish.forEach(f => items.push({ id: f.id, name: f.name, rarity: f.rarity, value: f.baseValue, unit: 'C$/kg', type: 'fish', imageUrl: f.imageUrl }));
    tradeItems.forEach(t => items.push({ id: t.id, name: t.name, rarity: t.rarity, value: t.value, unit: 'ER', type: t.itemType, imageUrl: t.imageUrl }));
    return items;
  }, [fish, tradeItems]);

  const filtered = useMemo(() => {
    let list = allItems;
    if (cat !== 'all') list = list.filter(i => i.type === cat);
    const q = query.toLowerCase().trim();
    if (q) list = list.filter(i => i.name.toLowerCase().includes(q));
    return list.slice(0, 40);
  }, [allItems, cat, query]);

  // Selected display name
  const selectedName = useMemo(() => {
    if (entryType === 'fish' && selectedFishId) {
      const f = fish.find(x => x.id === selectedFishId);
      return f?.name || '';
    }
    if (entryType === 'item' && selectedItemId) {
      const t = tradeItems.find(x => x.id === selectedItemId);
      return t?.name || '';
    }
    return '';
  }, [entryType, selectedFishId, selectedItemId, fish, tradeItems]);

  const handleSelect = (item: typeof allItems[0]) => {
    if (item.type === 'fish') {
      onSelectFish(item.id);
    } else {
      onSelectItem(item.id);
    }
    setOpen(false);
    setQuery('');
  };

  const categories: { key: Category; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'fish', label: 'Fish' },
    { key: 'boat', label: 'Boats' },
    { key: 'rod_skin', label: 'Rod Skins' },
  ];

  return (
    <div className="tc2__picker" ref={wrapRef}>
      <input
        className="tc2__picker-input"
        type="text"
        placeholder="Search items..."
        value={open ? query : selectedName}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={e => setQuery(e.target.value)}
      />
      {open && (
        <div className="tc2__picker-dropdown">
          <div className="tc2__picker-tabs">
            {categories.map(c => (
              <button
                key={c.key}
                className={`tc2__picker-tab${cat === c.key ? ' tc2__picker-tab--active' : ''}`}
                onMouseDown={e => { e.preventDefault(); setCat(c.key); }}
                type="button"
              >{c.label}</button>
            ))}
          </div>
          <div className="tc2__picker-list">
            {filtered.map(item => (
              <div
                key={`${item.type}-${item.id}`}
                className="tc2__picker-item"
                style={{ background: RARITY_GRADIENTS[item.rarity] || 'transparent' }}
                onMouseDown={() => handleSelect(item)}
              >
                {item.imageUrl ? (
                  <img className="tc2__picker-img" src={item.imageUrl} alt="" width="28" height="28" loading="lazy" />
                ) : (
                  <span className="tc2__picker-dot" style={{ background: RARITY_COLORS[item.rarity] || '#888' }} />
                )}
                <span className="tc2__picker-name">{item.name}</span>
                <span className="tc2__picker-meta">
                  <span className="tc2__picker-val">{fmt(item.value)}</span>
                  <span className="tc2__picker-unit">{item.unit}</span>
                </span>
              </div>
            ))}
            {filtered.length === 0 && <div className="tc2__picker-empty">No items found</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Trade Entry Card
   ================================================================ */

interface EntryCardProps {
  entry: TradeEntry;
  fish: SlimFish[];
  fishMap: Map<string, SlimFish>;
  itemMap: Map<string, TradeItem>;
  tradeItems: TradeItem[];
  sortedMutations: SlimMutation[];
  onChange: (field: Partial<TradeEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
  value: number;
}

function EntryCard({ entry, fish, fishMap, itemMap, tradeItems, sortedMutations, onChange, onRemove, canRemove, value }: EntryCardProps) {
  const selectedFish = entry.type === 'fish' ? fishMap.get(entry.fishId) : null;
  const selectedItem = entry.type === 'item' ? itemMap.get(entry.itemId) : null;
  const selected = selectedFish || selectedItem;
  const rarity = selectedFish?.rarity || selectedItem?.rarity || '';
  const bgGradient = RARITY_GRADIENTS[rarity] || 'transparent';

  const handleSelectFish = (id: string) => {
    const f = fish.find(x => x.id === id);
    onChange({ type: 'fish', fishId: id, itemId: '', weight: f ? f.baseWeight.toString() : '', qty: 1 });
  };

  const handleSelectItem = (id: string) => {
    onChange({ type: 'item', itemId: id, fishId: '', weight: '', mutationId: 'none', qty: 1 });
  };

  return (
    <div className="tc2__card" style={{ background: selected ? bgGradient : undefined }}>
      <div className="tc2__card-top">
        <ItemPicker
          fish={fish}
          tradeItems={tradeItems}
          onSelectFish={handleSelectFish}
          onSelectItem={handleSelectItem}
          selectedFishId={entry.fishId}
          selectedItemId={entry.itemId}
          entryType={entry.type}
        />
        {canRemove && (
          <button className="tc2__card-remove" onClick={onRemove} type="button" title="Remove">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        )}
      </div>

      {/* Fish-specific: weight + mutation */}
      {entry.type === 'fish' && entry.fishId && (
        <div className="tc2__card-fields">
          <div className="tc2__field">
            <label className="tc2__field-label">Weight (kg)</label>
            <input
              className="tc2__field-input"
              type="number"
              min={selectedFish?.weightMin ?? 0}
              max={selectedFish?.weightMax ?? 999999999}
              step="0.1"
              value={entry.weight}
              placeholder={selectedFish ? `${selectedFish.weightMin}–${selectedFish.weightMax}` : '—'}
              onChange={e => onChange({ weight: e.target.value })}
            />
          </div>
          <div className="tc2__field">
            <label className="tc2__field-label">Mutation</label>
            <select
              className="tc2__field-select"
              value={entry.mutationId}
              onChange={e => onChange({ mutationId: e.target.value })}
            >
              <option value="none">None (1x)</option>
              {sortedMutations.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.multiplier}x)</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Item-specific: quantity */}
      {entry.type === 'item' && entry.itemId && (
        <div className="tc2__card-qty">
          <span className="tc2__field-label">Qty</span>
          <div className="tc2__qty-ctrl">
            <button
              className="tc2__qty-btn"
              type="button"
              disabled={entry.qty <= 1}
              onClick={() => onChange({ qty: Math.max(1, entry.qty - 1) })}
            >−</button>
            <span className="tc2__qty-val">{entry.qty}</span>
            <button
              className="tc2__qty-btn"
              type="button"
              disabled={entry.qty >= 4}
              onClick={() => onChange({ qty: Math.min(4, entry.qty + 1) })}
            >+</button>
          </div>
        </div>
      )}

      {/* Value display */}
      {value > 0 && (
        <div className="tc2__card-value">
          <span className="tc2__card-value-num">{fmt(value)}</span>
          <span className="tc2__card-value-unit">{entry.type === 'fish' ? 'C$' : 'ER'}</span>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   Main Calculator
   ================================================================ */

export default function TradeCalc({ fish, mutations, tradeItems }: Props) {
  const nextKey = useRef(2);
  const [offer, setOffer] = useState<TradeEntry[]>([makeEntry(0)]);
  const [request, setRequest] = useState<TradeEntry[]>([makeEntry(1)]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const sortedMut = useMemo(() => [...mutations].sort((a, b) => b.multiplier - a.multiplier), [mutations]);
  const fishMap = useMemo(() => new Map(fish.map(f => [f.id, f])), [fish]);
  const itemMap = useMemo(() => new Map(tradeItems.map(t => [t.id, t])), [tradeItems]);

  const calcSide = useCallback((entries: TradeEntry[]) =>
    entries.reduce((s, e) => s + calcValue(e, fishMap, itemMap, sortedMut), 0),
    [fishMap, itemMap, sortedMut]);

  const offerTotal = useMemo(() => calcSide(offer), [offer, calcSide]);
  const requestTotal = useMemo(() => calcSide(request), [request, calcSide]);

  const { verdict, diffPct } = useMemo(() => {
    if (offerTotal === 0 && requestTotal === 0) return { verdict: null as null, diffPct: 0 };
    if (offerTotal === 0) return { verdict: 'PROFIT' as const, diffPct: 100 };
    if (requestTotal === 0) return { verdict: 'OVERPAY' as const, diffPct: -100 };
    const diff = ((requestTotal - offerTotal) / offerTotal) * 100;
    let v: 'PROFIT' | 'BALANCED' | 'OVERPAY';
    if (diff > 5) v = 'PROFIT';
    else if (diff < -5) v = 'OVERPAY';
    else v = 'BALANCED';
    return { verdict: v, diffPct: diff };
  }, [offerTotal, requestTotal]);

  const updateEntry = useCallback((side: 'offer' | 'request', key: number, field: Partial<TradeEntry>) => {
    const setter = side === 'offer' ? setOffer : setRequest;
    setter(prev => prev.map(e => e.key === key ? { ...e, ...field } : e));
  }, []);

  const addEntry = useCallback((side: 'offer' | 'request') => {
    const entry = makeEntry(nextKey.current++);
    if (side === 'offer') setOffer(p => [...p, entry]);
    else setRequest(p => [...p, entry]);
  }, []);

  const removeEntry = useCallback((side: 'offer' | 'request', key: number) => {
    if (side === 'offer') setOffer(p => p.filter(e => e.key !== key));
    else setRequest(p => p.filter(e => e.key !== key));
  }, []);

  const swapSides = useCallback(() => {
    setOffer(prev => {
      setRequest(offer);
      return request;
    });
  }, [offer, request]);

  const clearAll = useCallback(() => {
    setOffer([makeEntry(nextKey.current++)]);
    setRequest([makeEntry(nextKey.current++)]);
  }, []);

  const saveHistory = useCallback(() => {
    if (!verdict) return;
    setHistory(prev => [{ offerTotal, requestTotal, verdict, diff: diffPct, ts: Date.now() }, ...prev].slice(0, 10));
  }, [verdict, offerTotal, requestTotal, diffPct]);

  const total = offerTotal + requestTotal;
  const offerPct = total > 0 ? (offerTotal / total) * 100 : 50;
  const requestPct = total > 0 ? (requestTotal / total) * 100 : 50;

  const verdictColor = verdict === 'PROFIT' ? '#00ffaa' : verdict === 'BALANCED' ? '#fbbf24' : '#ff4d4d';
  const verdictBg = verdict === 'PROFIT' ? 'rgba(0,255,170,0.08)' : verdict === 'BALANCED' ? 'rgba(251,191,36,0.08)' : 'rgba(255,77,77,0.08)';
  const verdictMsg = verdict === 'PROFIT' ? "You're receiving more value" : verdict === 'BALANCED' ? 'Fair trade' : "You're giving more value";

  const renderSide = (side: 'offer' | 'request', entries: TradeEntry[], sideTotal: number) => {
    const isOffer = side === 'offer';
    const accent = isOffer ? '#22d3ee' : '#818cf8';
    return (
      <div className="tc2__side">
        <div className="tc2__side-header" style={{ borderBottomColor: `${accent}40` }}>
          <span className="tc2__side-title" style={{ color: accent }}>
            {isOffer ? 'OFFERING' : 'REQUESTING'}
          </span>
          <span className="tc2__side-count">{entries.filter(e => e.fishId || e.itemId).length} items</span>
        </div>

        <div className="tc2__side-entries">
          {entries.map(entry => (
            <EntryCard
              key={entry.key}
              entry={entry}
              fish={fish}
              fishMap={fishMap}
              itemMap={itemMap}
              tradeItems={tradeItems}
              sortedMutations={sortedMut}
              onChange={(field) => updateEntry(side, entry.key, field)}
              onRemove={() => removeEntry(side, entry.key)}
              canRemove={entries.length > 1}
              value={calcValue(entry, fishMap, itemMap, sortedMut)}
            />
          ))}
        </div>

        <button className="tc2__add-btn" onClick={() => addEntry(side)} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          Add Item
        </button>

        <div className="tc2__side-total">
          <span className="tc2__side-total-label">Total</span>
          <span className="tc2__side-total-val" style={{ color: accent }}>{fmt(sideTotal)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="tc2">
      {/* Action bar */}
      <div className="tc2__actions">
        <button className="tc2__action-btn" onClick={swapSides} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
          Swap
        </button>
        <button className="tc2__action-btn tc2__action-btn--danger" onClick={clearAll} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6l1 14h12l1-14"/></svg>
          Reset
        </button>
      </div>

      {/* Two-column layout */}
      <div className="tc2__grid">
        {renderSide('offer', offer, offerTotal)}

        <div className="tc2__divider">
          <div className="tc2__divider-line" />
          <span className="tc2__divider-vs">VS</span>
          <div className="tc2__divider-line" />
        </div>

        {renderSide('request', request, requestTotal)}
      </div>

      {/* Verdict */}
      {verdict && (
        <div className="tc2__verdict" style={{ borderColor: `${verdictColor}50`, background: verdictBg }}>
          <div className="tc2__verdict-header">
            <span className="tc2__verdict-label">TRADE VERDICT</span>
            <span className="tc2__verdict-badge" style={{ color: verdictColor, background: `${verdictColor}18`, borderColor: `${verdictColor}40` }}>
              {verdict}
            </span>
          </div>
          <p className="tc2__verdict-msg" style={{ color: verdictColor }}>{verdictMsg}</p>
          <div className="tc2__verdict-diff">
            {diffPct > 0 ? `+${diffPct.toFixed(1)}%` : `${diffPct.toFixed(1)}%`}
          </div>

          {/* Proportion bar */}
          <div className="tc2__bar">
            <div className="tc2__bar-offer" style={{ width: `${offerPct}%` }}>
              {offerPct >= 18 && <span className="tc2__bar-text">{fmt(offerTotal)}</span>}
            </div>
            <div className="tc2__bar-request" style={{ width: `${requestPct}%` }}>
              {requestPct >= 18 && <span className="tc2__bar-text">{fmt(requestTotal)}</span>}
            </div>
          </div>
          <div className="tc2__bar-labels">
            <span style={{ color: '#22d3ee' }}>Offering</span>
            <span style={{ color: '#818cf8' }}>Requesting</span>
          </div>

          <button className="tc2__save-btn" onClick={saveHistory} type="button">Save to History</button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="tc2__history">
          <h3 className="tc2__history-title">Recent Trades</h3>
          {history.map(h => {
            const hColor = h.verdict === 'PROFIT' ? '#00ffaa' : h.verdict === 'BALANCED' ? '#fbbf24' : '#ff4d4d';
            return (
              <div key={h.ts} className="tc2__history-row" style={{ borderLeftColor: hColor }}>
                <span className="tc2__history-badge" style={{ color: hColor, background: `${hColor}15` }}>{h.verdict}</span>
                <span className="tc2__history-vals">{fmt(h.offerTotal)} vs {fmt(h.requestTotal)}</span>
                <span className="tc2__history-diff" style={{ color: hColor }}>{h.diff > 0 ? '+' : ''}{h.diff.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
