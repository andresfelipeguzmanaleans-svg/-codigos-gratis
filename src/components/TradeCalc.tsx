import { useState, useMemo, useCallback, useRef, useEffect } from 'react';

// ---------- Types ----------

export interface SlimFish {
  id: string;
  name: string;
  rarity: string;
  baseValue: number;
  baseWeight: number;
  weightMin: number;
  weightMax: number;
}

export interface SlimMutation {
  id: string;
  name: string;
  multiplier: number;
  category: string;
}

interface Props {
  fish: SlimFish[];
  mutations: SlimMutation[];
}

interface TradeEntry {
  key: number;
  fishId: string;
  weight: string;
  mutationId: string;
}

interface HistoryEntry {
  yourTotal: number;
  theirTotal: number;
  result: 'WIN' | 'FAIR' | 'LOSE';
  diff: number;
  timestamp: number;
}

// ---------- Constants ----------

const RARITY_COLORS: Record<string, string> = {
  'Trash': '#71717a', 'Common': '#9ca3af', 'Uncommon': '#22c55e', 'Unusual': '#34d39e',
  'Rare': '#3b82f6', 'Legendary': '#f59e0b', 'Mythical': '#a855f7', 'Exotic': '#ec4899',
  'Limited': '#ef4444', 'Special': '#06b6d4', 'Secret': '#fbbf24', 'Divine Secret': '#fde68a',
  'Apex': '#f43f5e', 'Extinct': '#a8a29e', 'Relic': '#c084fc', 'Gemstone': '#2dd4bf',
  'Fragment': '#67e8f9',
};

function fmtC(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

// ---------- Helpers ----------

function calcEntryValue(
  entry: TradeEntry,
  fishMap: Map<string, SlimFish>,
  mutations: SlimMutation[],
): number {
  if (!entry.fishId) return 0;
  const f = fishMap.get(entry.fishId);
  if (!f) return 0;
  const w = parseFloat(entry.weight) || 0;
  if (w <= 0) return 0;
  const mut = mutations.find(m => m.id === entry.mutationId);
  const mult = mut ? mut.multiplier : 1;
  return f.baseValue * w * mult;
}

function makeEntry(key: number): TradeEntry {
  return { key, fishId: '', weight: '', mutationId: 'none' };
}

// ---------- FishSearch sub-component ----------

interface FishSearchProps {
  fish: SlimFish[];
  selectedId: string;
  onSelect: (fishId: string) => void;
  idPrefix: string;
}

function FishSearch({ fish, selectedId, onSelect, idPrefix }: FishSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return fish.slice(0, 30);
    return fish.filter(f => f.name.toLowerCase().includes(q)).slice(0, 30);
  }, [fish, query]);

  const selectedFish = useMemo(
    () => (selectedId ? fish.find(f => f.id === selectedId) : null),
    [fish, selectedId],
  );

  return (
    <div className="tc__fish-search" ref={wrapRef}>
      <input
        className="tc__fish-input"
        type="text"
        placeholder="Search fish..."
        value={open ? query : (selectedFish?.name || '')}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={e => setQuery(e.target.value)}
      />
      {open && (
        <div className="tc__fish-dropdown">
          {filtered.map(f => (
            <div
              key={f.id}
              className={`tc__fish-option${f.id === selectedId ? ' tc__fish-option--sel' : ''}`}
              onMouseDown={() => { onSelect(f.id); setOpen(false); setQuery(''); }}
            >
              <span className="tc__fish-dot" style={{ background: RARITY_COLORS[f.rarity] || '#888' }} />
              <span className="tc__fish-option-name">{f.name}</span>
              <span className="tc__fish-option-val">{f.baseValue.toLocaleString('en-US')} C$/kg</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="tc__fish-no-match">No fish found</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- TradeEntryRow sub-component ----------

interface TradeEntryRowProps {
  entry: TradeEntry;
  fish: SlimFish[];
  fishMap: Map<string, SlimFish>;
  sortedMutations: SlimMutation[];
  onChange: (field: Partial<TradeEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
  idPrefix: string;
}

function TradeEntryRow({
  entry, fish, fishMap, sortedMutations, onChange, onRemove, canRemove, idPrefix,
}: TradeEntryRowProps) {
  const selectedFish = entry.fishId ? fishMap.get(entry.fishId) : null;
  const entryValue = calcEntryValue(entry, fishMap, sortedMutations);

  return (
    <div className="tc__entry">
      <div className="tc__entry-top">
        <FishSearch
          fish={fish}
          selectedId={entry.fishId}
          onSelect={(id) => onChange({ fishId: id })}
          idPrefix={idPrefix}
        />
        {canRemove && (
          <button className="tc__entry-remove" onClick={onRemove} type="button" title="Remove">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        )}
      </div>

      <div className="tc__entry-fields">
        <div className="tc__field">
          <label className="tc__field-label">Weight (kg)</label>
          <input
            className="tc__field-input"
            type="number"
            min={selectedFish?.weightMin ?? 0}
            max={selectedFish?.weightMax ?? 999999999}
            step="0.1"
            value={entry.weight}
            placeholder={selectedFish ? `${selectedFish.weightMin} – ${selectedFish.weightMax}` : '—'}
            onChange={e => onChange({ weight: e.target.value })}
          />
        </div>

        <div className="tc__field">
          <label className="tc__field-label">Mutation</label>
          <select
            className="tc__field-select"
            value={entry.mutationId}
            onChange={e => onChange({ mutationId: e.target.value })}
          >
            <option value="none">None (1x)</option>
            {sortedMutations.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.multiplier}x)
              </option>
            ))}
          </select>
        </div>
      </div>

      {entryValue > 0 && (
        <div className="tc__entry-value">
          = <span className="tc__entry-value-num">{fmtC(entryValue)} C$</span>
        </div>
      )}
    </div>
  );
}

// ---------- Main component ----------

export default function TradeCalc({ fish, mutations }: Props) {
  const nextKeyRef = useRef(2);

  const [yourItems, setYourItems] = useState<TradeEntry[]>([makeEntry(0)]);
  const [theirItems, setTheirItems] = useState<TradeEntry[]>([makeEntry(1)]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const sortedMutations = useMemo(
    () => [...mutations].sort((a, b) => b.multiplier - a.multiplier),
    [mutations],
  );

  const fishMap = useMemo(
    () => new Map(fish.map(f => [f.id, f])),
    [fish],
  );

  // --- Totals ---
  const yourTotal = useMemo(
    () => yourItems.reduce((s, e) => s + calcEntryValue(e, fishMap, sortedMutations), 0),
    [yourItems, fishMap, sortedMutations],
  );

  const theirTotal = useMemo(
    () => theirItems.reduce((s, e) => s + calcEntryValue(e, fishMap, sortedMutations), 0),
    [theirItems, fishMap, sortedMutations],
  );

  // --- Result ---
  const { result, diffPct } = useMemo(() => {
    if (yourTotal === 0 && theirTotal === 0) return { result: null as null, diffPct: 0 };
    if (yourTotal === 0) return { result: 'WIN' as const, diffPct: 100 };
    if (theirTotal === 0) return { result: 'LOSE' as const, diffPct: -100 };
    const diff = ((theirTotal - yourTotal) / yourTotal) * 100;
    let r: 'WIN' | 'FAIR' | 'LOSE';
    if (diff > 10) r = 'WIN';
    else if (diff < -10) r = 'LOSE';
    else r = 'FAIR';
    return { result: r, diffPct: diff };
  }, [yourTotal, theirTotal]);

  // --- Actions ---
  const addEntry = useCallback((side: 'yours' | 'theirs') => {
    const entry = makeEntry(nextKeyRef.current++);
    if (side === 'yours') setYourItems(p => [...p, entry]);
    else setTheirItems(p => [...p, entry]);
  }, []);

  const removeEntry = useCallback((side: 'yours' | 'theirs', key: number) => {
    if (side === 'yours') setYourItems(p => p.filter(e => e.key !== key));
    else setTheirItems(p => p.filter(e => e.key !== key));
  }, []);

  const updateEntry = useCallback((side: 'yours' | 'theirs', key: number, field: Partial<TradeEntry>) => {
    const setter = side === 'yours' ? setYourItems : setTheirItems;
    setter(prev => prev.map(e => {
      if (e.key !== key) return e;
      const updated = { ...e, ...field };
      if (field.fishId && field.fishId !== e.fishId) {
        const f = fish.find(ff => ff.id === field.fishId);
        if (f) updated.weight = f.baseWeight.toString();
      }
      return updated;
    }));
  }, [fish]);

  const swapSides = useCallback(() => {
    const y = yourItems;
    const t = theirItems;
    setYourItems(t);
    setTheirItems(y);
  }, [yourItems, theirItems]);

  const clearAll = useCallback(() => {
    setYourItems([makeEntry(nextKeyRef.current++)]);
    setTheirItems([makeEntry(nextKeyRef.current++)]);
  }, []);

  const saveToHistory = useCallback(() => {
    if (result === null) return;
    setHistory(prev => [{
      yourTotal,
      theirTotal,
      result,
      diff: diffPct,
      timestamp: Date.now(),
    }, ...prev].slice(0, 10));
  }, [result, yourTotal, theirTotal, diffPct]);

  // --- Proportion bar widths ---
  const total = yourTotal + theirTotal;
  const yourPct = total > 0 ? (yourTotal / total) * 100 : 50;
  const theirPct = total > 0 ? (theirTotal / total) * 100 : 50;

  return (
    <div className="tc">
      {/* ACTION BAR */}
      <div className="tc__actions">
        <button className="tc__action-btn" onClick={swapSides} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
          Swap Sides
        </button>
        <button className="tc__action-btn tc__action-btn--danger" onClick={clearAll} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6l1 14h12l1-14"/></svg>
          Clear All
        </button>
      </div>

      {/* COLUMNS */}
      <div className="tc__columns">
        {/* YOUR ITEMS */}
        <div className="tc__column">
          <h3 className="tc__col-title tc__col-title--yours">Your Items</h3>
          {yourItems.map(entry => (
            <TradeEntryRow
              key={entry.key}
              entry={entry}
              fish={fish}
              fishMap={fishMap}
              sortedMutations={sortedMutations}
              onChange={(field) => updateEntry('yours', entry.key, field)}
              onRemove={() => removeEntry('yours', entry.key)}
              canRemove={yourItems.length > 1}
              idPrefix={`y-${entry.key}`}
            />
          ))}
          <button className="tc__add-btn" onClick={() => addEntry('yours')} type="button">+ Add Fish</button>
          <div className="tc__side-total">
            Total: <span className="tc__side-total-val">{fmtC(yourTotal)} C$</span>
          </div>
        </div>

        {/* VS divider */}
        <div className="tc__vs">VS</div>

        {/* THEIR ITEMS */}
        <div className="tc__column">
          <h3 className="tc__col-title tc__col-title--theirs">Their Items</h3>
          {theirItems.map(entry => (
            <TradeEntryRow
              key={entry.key}
              entry={entry}
              fish={fish}
              fishMap={fishMap}
              sortedMutations={sortedMutations}
              onChange={(field) => updateEntry('theirs', entry.key, field)}
              onRemove={() => removeEntry('theirs', entry.key)}
              canRemove={theirItems.length > 1}
              idPrefix={`t-${entry.key}`}
            />
          ))}
          <button className="tc__add-btn" onClick={() => addEntry('theirs')} type="button">+ Add Fish</button>
          <div className="tc__side-total">
            Total: <span className="tc__side-total-val">{fmtC(theirTotal)} C$</span>
          </div>
        </div>
      </div>

      {/* RESULT */}
      {result !== null && (
        <div className={`tc__result tc__result--${result.toLowerCase()}`}>
          <div className="tc__result-badge">{result}</div>
          <div className="tc__result-diff">
            {diffPct > 0 ? `You gain +${diffPct.toFixed(1)}%` : diffPct < 0 ? `You lose ${diffPct.toFixed(1)}%` : 'Even trade'}
          </div>
          <div className="tc__result-vals">
            <span>You give: {fmtC(yourTotal)} C$</span>
            <span>You get: {fmtC(theirTotal)} C$</span>
          </div>

          {/* Proportion bar */}
          <div className="tc__bar">
            <div className="tc__bar-yours" style={{ width: `${yourPct}%` }}>
              {yourPct >= 20 && <span className="tc__bar-label">{fmtC(yourTotal)}</span>}
            </div>
            <div className="tc__bar-theirs" style={{ width: `${theirPct}%` }}>
              {theirPct >= 20 && <span className="tc__bar-label">{fmtC(theirTotal)}</span>}
            </div>
          </div>
          <div className="tc__bar-legend">
            <span className="tc__bar-legend-yours">You give</span>
            <span className="tc__bar-legend-theirs">You get</span>
          </div>

          <button className="tc__save-btn" onClick={saveToHistory} type="button">Save to History</button>
        </div>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <div className="tc__history">
          <h3 className="tc__history-title">Recent Trades</h3>
          {history.map(h => (
            <div key={h.timestamp} className={`tc__history-row tc__history-row--${h.result.toLowerCase()}`}>
              <span className={`tc__history-badge tc__history-badge--${h.result.toLowerCase()}`}>{h.result}</span>
              <span className="tc__history-vals">{fmtC(h.yourTotal)} vs {fmtC(h.theirTotal)}</span>
              <span className="tc__history-diff">{h.diff > 0 ? '+' : ''}{h.diff.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
