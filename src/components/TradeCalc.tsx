import { useState, useMemo, useCallback, useRef } from 'react';

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

/* Slot data: what fills a cell in the 3×3 grid */
interface SlotData {
  uid: number;
  kind: 'fish' | 'item';
  id: string;
  qty: number;
  weight: number;
  mutationId: string;
}

type Category = 'all' | 'fish' | 'boat' | 'rod_skin';

/* ================================================================
   Constants
   ================================================================ */

const SLOT_COUNT = 9;

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

function rarityGrad(rarity: string): string {
  const c = RARITY_COLORS[rarity] || '#666';
  return `linear-gradient(180deg, ${c}30 0%, ${c}12 40%, rgba(17,17,17,0.95) 100%)`;
}

function fmt(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

/* ================================================================
   Main Component
   ================================================================ */

export default function TradeCalc({ fish, mutations, tradeItems }: Props) {
  const uidRef = useRef(0);

  // 9 slots per side
  const [offer, setOffer] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));
  const [request, setRequest] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));

  // Modal picker state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSide, setModalSide] = useState<'offer' | 'request'>('offer');
  const [modalSlot, setModalSlot] = useState(0);
  const [modalCat, setModalCat] = useState<Category>('all');
  const [modalQuery, setModalQuery] = useState('');

  // Configure step (after selecting item in modal)
  const [cfgItem, setCfgItem] = useState<{ kind: 'fish' | 'item'; id: string } | null>(null);
  const [cfgWeight, setCfgWeight] = useState('');
  const [cfgMutation, setCfgMutation] = useState('none');
  const [cfgQty, setCfgQty] = useState(1);

  const [swapping, setSwapping] = useState(false);

  // Lookup maps
  const fishMap = useMemo(() => new Map(fish.map(f => [f.id, f])), [fish]);
  const itemMap = useMemo(() => new Map(tradeItems.map(t => [t.id, t])), [tradeItems]);
  const sortedMut = useMemo(() => [...mutations].sort((a, b) => b.multiplier - a.multiplier), [mutations]);

  // Value calculation
  const slotValue = useCallback((slot: SlotData | null): number => {
    if (!slot) return 0;
    if (slot.kind === 'item') {
      const item = itemMap.get(slot.id);
      return item ? item.value * slot.qty : 0;
    }
    const f = fishMap.get(slot.id);
    if (!f || slot.weight <= 0) return 0;
    const mut = mutations.find(m => m.id === slot.mutationId);
    return f.baseValue * slot.weight * (mut ? mut.multiplier : 1);
  }, [fishMap, itemMap, mutations]);

  const offerTotal = useMemo(() => offer.reduce((s, sl) => s + slotValue(sl), 0), [offer, slotValue]);
  const requestTotal = useMemo(() => request.reduce((s, sl) => s + slotValue(sl), 0), [request, slotValue]);
  const total = offerTotal + requestTotal;
  const offerPct = total > 0 ? (offerTotal / total) * 100 : 50;

  const verdict = useMemo(() => {
    if (offerTotal === 0 && requestTotal === 0) return null;
    if (offerTotal === 0) return { v: 'PROFIT' as const, diff: 100 };
    if (requestTotal === 0) return { v: 'OVERPAY' as const, diff: -100 };
    const diff = ((requestTotal - offerTotal) / offerTotal) * 100;
    const v = diff > 5 ? 'PROFIT' as const : diff < -5 ? 'OVERPAY' as const : 'BALANCED' as const;
    return { v, diff };
  }, [offerTotal, requestTotal]);

  const verdictColor = !verdict ? '#888' : verdict.v === 'PROFIT' ? '#00ffaa' : verdict.v === 'BALANCED' ? '#fbbf24' : '#ff4d4d';

  // Slot info helper
  const getSlotInfo = useCallback((slot: SlotData) => {
    if (slot.kind === 'fish') {
      const f = fishMap.get(slot.id);
      return { name: f?.name || '?', rarity: f?.rarity || '', imageUrl: f?.imageUrl || null };
    }
    const item = itemMap.get(slot.id);
    return { name: item?.name || '?', rarity: item?.rarity || '', imageUrl: item?.imageUrl || null };
  }, [fishMap, itemMap]);

  // --- Actions ---
  const openModal = useCallback((side: 'offer' | 'request', idx: number) => {
    setModalSide(side);
    setModalSlot(idx);
    setModalCat('all');
    setModalQuery('');
    setCfgItem(null);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setCfgItem(null);
  }, []);

  const selectInModal = useCallback((kind: 'fish' | 'item', id: string) => {
    setCfgItem({ kind, id });
    if (kind === 'fish') {
      const f = fishMap.get(id);
      setCfgWeight(f ? f.baseWeight.toString() : '1');
      setCfgMutation('none');
    } else {
      setCfgQty(1);
    }
  }, [fishMap]);

  const confirmAdd = useCallback(() => {
    if (!cfgItem) return;
    const slot: SlotData = {
      uid: uidRef.current++,
      kind: cfgItem.kind,
      id: cfgItem.id,
      qty: cfgItem.kind === 'item' ? cfgQty : 1,
      weight: cfgItem.kind === 'fish' ? (parseFloat(cfgWeight) || 0) : 0,
      mutationId: cfgItem.kind === 'fish' ? cfgMutation : 'none',
    };
    const setter = modalSide === 'offer' ? setOffer : setRequest;
    setter(prev => prev.map((s, i) => i === modalSlot ? slot : s));
    closeModal();
  }, [cfgItem, cfgQty, cfgWeight, cfgMutation, modalSide, modalSlot, closeModal]);

  const removeSlot = useCallback((side: 'offer' | 'request', idx: number) => {
    const setter = side === 'offer' ? setOffer : setRequest;
    setter(prev => prev.map((s, i) => i === idx ? null : s));
  }, []);

  const swapSides = useCallback(() => {
    setSwapping(true);
    setTimeout(() => {
      const o = offer;
      const r = request;
      setOffer(r);
      setRequest(o);
      setSwapping(false);
    }, 400);
  }, [offer, request]);

  const clearAll = useCallback(() => {
    setOffer(Array(SLOT_COUNT).fill(null));
    setRequest(Array(SLOT_COUNT).fill(null));
  }, []);

  // Filtered items for modal
  const modalItems = useMemo(() => {
    type PI = { id: string; name: string; rarity: string; value: number; unit: string; kind: 'fish' | 'item'; cat: Category; imageUrl: string | null };
    const items: PI[] = [];
    if (modalCat === 'all' || modalCat === 'fish') {
      fish.forEach(f => items.push({ id: f.id, name: f.name, rarity: f.rarity, value: f.baseValue, unit: 'C$/kg', kind: 'fish', cat: 'fish', imageUrl: f.imageUrl || null }));
    }
    if (modalCat === 'all' || modalCat === 'boat' || modalCat === 'rod_skin') {
      tradeItems.forEach(t => {
        if (modalCat !== 'all' && t.itemType !== modalCat) return;
        items.push({ id: t.id, name: t.name, rarity: t.rarity, value: t.value, unit: 'ER', kind: 'item', cat: t.itemType as Category, imageUrl: t.imageUrl || null });
      });
    }
    const q = modalQuery.toLowerCase().trim();
    if (q) return items.filter(i => i.name.toLowerCase().includes(q));
    return items;
  }, [fish, tradeItems, modalCat, modalQuery]);

  // --- Render zone (one side) ---
  const renderZone = (side: 'offer' | 'request', slots: (SlotData | null)[], sideTotal: number) => {
    const isOffer = side === 'offer';
    const accent = isOffer ? '#22d3ee' : '#818cf8';
    const filled = slots.filter(Boolean).length;

    return (
      <div className={`tc2__zone${swapping ? (isOffer ? ' tc2__zone--swap-r' : ' tc2__zone--swap-l') : ''}`}>
        <div className="tc2__zone-head">
          <span className="tc2__zone-label" style={{ color: accent }}>
            {isOffer ? 'OFFERING' : 'REQUESTING'}
          </span>
          <span className="tc2__zone-count">{filled}/{SLOT_COUNT}</span>
        </div>

        <div className="tc2__slots">
          {slots.map((slot, idx) =>
            slot ? (
              <div
                key={slot.uid}
                className="tc2__slot tc2__slot--filled"
                style={{ background: rarityGrad(getSlotInfo(slot).rarity) }}
              >
                <div className="tc2__slot-img-wrap">
                  {getSlotInfo(slot).imageUrl ? (
                    <img className="tc2__slot-img" src={getSlotInfo(slot).imageUrl!} alt="" loading="lazy" />
                  ) : (
                    <div className="tc2__slot-dot" style={{ background: RARITY_COLORS[getSlotInfo(slot).rarity] || '#666' }} />
                  )}
                </div>
                {slot.qty > 1 && <span className="tc2__slot-qty">x{slot.qty}</span>}
                <div className="tc2__slot-val">{fmt(slotValue(slot))}</div>
                <div className="tc2__slot-name">{getSlotInfo(slot).name}</div>
                <button
                  className="tc2__slot-rm"
                  onClick={() => removeSlot(side, idx)}
                  type="button"
                  title="Remove"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            ) : (
              <button
                key={`e${idx}`}
                className="tc2__slot tc2__slot--empty"
                onClick={() => openModal(side, idx)}
                type="button"
              >
                <svg className="tc2__slot-plus" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
            )
          )}
        </div>

        <div className="tc2__zone-total" style={{ borderLeftColor: accent }}>
          <span className="tc2__zone-total-lbl">VALUE</span>
          <span className="tc2__zone-total-num" style={{ color: accent }}>{fmt(sideTotal)}</span>
        </div>
      </div>
    );
  };

  // --- Configure panel inside modal ---
  const renderConfig = () => {
    if (!cfgItem) return null;

    if (cfgItem.kind === 'fish') {
      const f = fishMap.get(cfgItem.id);
      if (!f) return null;
      const mut = sortedMut.find(m => m.id === cfgMutation);
      const w = parseFloat(cfgWeight) || 0;
      const preview = f.baseValue * w * (mut ? mut.multiplier : 1);

      return (
        <div className="tc2__cfg">
          <div className="tc2__cfg-card" style={{ background: rarityGrad(f.rarity) }}>
            {f.imageUrl && <img className="tc2__cfg-img" src={f.imageUrl} alt="" />}
            <div className="tc2__cfg-info">
              <span className="tc2__cfg-name">{f.name}</span>
              <span className="tc2__cfg-rarity" style={{ color: RARITY_COLORS[f.rarity] || '#888' }}>{f.rarity}</span>
              <span className="tc2__cfg-base">{fmt(f.baseValue)} C$/kg</span>
            </div>
          </div>

          <div className="tc2__cfg-fields">
            <div className="tc2__cfg-field">
              <label className="tc2__cfg-lbl">Weight (kg)</label>
              <input
                className="tc2__cfg-input"
                type="number"
                min={f.weightMin}
                max={f.weightMax}
                step="0.1"
                value={cfgWeight}
                placeholder={`${f.weightMin}–${f.weightMax}`}
                onChange={e => setCfgWeight(e.target.value)}
              />
              <span className="tc2__cfg-hint">{f.weightMin} – {f.weightMax} kg</span>
            </div>
            <div className="tc2__cfg-field">
              <label className="tc2__cfg-lbl">Mutation</label>
              <select
                className="tc2__cfg-select"
                value={cfgMutation}
                onChange={e => setCfgMutation(e.target.value)}
              >
                <option value="none">None (1x)</option>
                {sortedMut.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.multiplier}x)</option>
                ))}
              </select>
            </div>
          </div>

          {preview > 0 && (
            <div className="tc2__cfg-preview-val">
              Estimated: <strong>{fmt(preview)} C$</strong>
            </div>
          )}
        </div>
      );
    }

    // boat / rod skin
    const item = itemMap.get(cfgItem.id);
    if (!item) return null;
    const preview = item.value * cfgQty;

    return (
      <div className="tc2__cfg">
        <div className="tc2__cfg-card" style={{ background: rarityGrad(item.rarity) }}>
          {item.imageUrl && <img className="tc2__cfg-img" src={item.imageUrl} alt="" />}
          <div className="tc2__cfg-info">
            <span className="tc2__cfg-name">{item.name}</span>
            <span className="tc2__cfg-rarity" style={{ color: RARITY_COLORS[item.rarity] || '#888' }}>{item.rarity}</span>
            <span className="tc2__cfg-base">{fmt(item.value)} ER</span>
          </div>
        </div>

        <div className="tc2__cfg-qty-row">
          <span className="tc2__cfg-lbl">Quantity</span>
          <div className="tc2__cfg-qty">
            <button className="tc2__cfg-qty-btn" type="button" disabled={cfgQty <= 1} onClick={() => setCfgQty(q => Math.max(1, q - 1))}>−</button>
            <span className="tc2__cfg-qty-num">{cfgQty}</span>
            <button className="tc2__cfg-qty-btn" type="button" disabled={cfgQty >= 4} onClick={() => setCfgQty(q => Math.min(4, q + 1))}>+</button>
          </div>
        </div>

        <div className="tc2__cfg-preview-val">
          Total: <strong>{fmt(preview)} ER</strong>
        </div>
      </div>
    );
  };

  /* ================================================================
     RENDER
     ================================================================ */

  return (
    <div className="tc2">
      {/* Action bar */}
      <div className="tc2__actions">
        <button className="tc2__act-btn" onClick={swapSides} type="button" disabled={swapping}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
          Swap
        </button>
        <button className="tc2__act-btn tc2__act-btn--danger" onClick={clearAll} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6l1 14h12l1-14"/></svg>
          Clear
        </button>
      </div>

      {/* Exchange grid */}
      <div className="tc2__exchange">
        {renderZone('offer', offer, offerTotal)}

        <div className="tc2__mid">
          <div className="tc2__vs">VS</div>
          <div className="tc2__gauge">
            <div className="tc2__gauge-track" />
            <div
              className="tc2__gauge-dot"
              style={{
                top: `${100 - offerPct}%`,
                background: verdictColor,
                boxShadow: `0 0 10px ${verdictColor}`,
              }}
            />
          </div>
          <button className="tc2__swap-btn" onClick={swapSides} type="button" disabled={swapping} title="Swap sides">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
          </button>
        </div>

        {renderZone('request', request, requestTotal)}
      </div>

      {/* Verdict */}
      {verdict && (
        <div className="tc2__verdict" style={{ borderColor: `${verdictColor}40`, background: `${verdictColor}08` }}>
          <div className="tc2__verdict-icon" style={{ color: verdictColor, background: `${verdictColor}15` }}>
            {verdict.v === 'PROFIT' ? '↑' : verdict.v === 'BALANCED' ? '≈' : '↓'}
          </div>
          <div className="tc2__verdict-body">
            <span className="tc2__verdict-tag" style={{ color: verdictColor }}>{verdict.v}</span>
            <p className="tc2__verdict-msg">
              {verdict.v === 'PROFIT' ? "You're receiving more value" : verdict.v === 'BALANCED' ? 'Fair trade (within 5%)' : "You're giving more value"}
            </p>
          </div>
          <div className="tc2__verdict-pct" style={{ color: verdictColor }}>
            {verdict.diff > 0 ? '+' : ''}{verdict.diff.toFixed(1)}%
          </div>
        </div>
      )}

      {/* Proportion bar */}
      {verdict && (
        <div className="tc2__bar-section">
          <div className="tc2__bar">
            <div className="tc2__bar-l" style={{ width: `${offerPct}%` }}>
              {offerPct >= 20 && <span className="tc2__bar-txt">{fmt(offerTotal)}</span>}
            </div>
            <div className="tc2__bar-r" style={{ width: `${100 - offerPct}%` }}>
              {(100 - offerPct) >= 20 && <span className="tc2__bar-txt">{fmt(requestTotal)}</span>}
            </div>
          </div>
          <div className="tc2__bar-leg">
            <span style={{ color: '#22d3ee' }}>Offering</span>
            <span style={{ color: '#818cf8' }}>Requesting</span>
          </div>
        </div>
      )}

      {/* ============ MODAL ============ */}
      {modalOpen && (
        <div className="tc2__overlay" onClick={closeModal}>
          <div className="tc2__modal" onClick={e => e.stopPropagation()}>
            {!cfgItem ? (
              <>
                {/* BROWSE */}
                <div className="tc2__m-head">
                  <h3 className="tc2__m-title">Select Item</h3>
                  <button className="tc2__m-close" onClick={closeModal} type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>

                <div className="tc2__m-search">
                  <svg className="tc2__m-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <input
                    className="tc2__m-search-input"
                    type="text"
                    placeholder="Search items..."
                    value={modalQuery}
                    onChange={e => setModalQuery(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="tc2__m-cats">
                  {([['all', 'All'], ['fish', 'Fish'], ['boat', 'Boats'], ['rod_skin', 'Rod Skins']] as [Category, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      className={`tc2__m-cat${modalCat === key ? ' tc2__m-cat--on' : ''}`}
                      onClick={() => setModalCat(key)}
                      type="button"
                    >{label}</button>
                  ))}
                </div>

                <div className="tc2__m-grid">
                  {modalItems.slice(0, 80).map(item => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      className="tc2__m-item"
                      style={{ background: rarityGrad(item.rarity) }}
                      onClick={() => selectInModal(item.kind, item.id)}
                      type="button"
                    >
                      <div className="tc2__m-item-imgbox">
                        {item.imageUrl ? (
                          <img className="tc2__m-item-img" src={item.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="tc2__m-item-dot" style={{ background: RARITY_COLORS[item.rarity] || '#666' }} />
                        )}
                      </div>
                      <span className="tc2__m-item-name">{item.name}</span>
                      <span className="tc2__m-item-val">{fmt(item.value)} <small>{item.unit}</small></span>
                    </button>
                  ))}
                  {modalItems.length === 0 && <div className="tc2__m-empty">No items found</div>}
                </div>
              </>
            ) : (
              <>
                {/* CONFIGURE */}
                <div className="tc2__m-head">
                  <button className="tc2__m-back" onClick={() => setCfgItem(null)} type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  <h3 className="tc2__m-title">Configure</h3>
                  <button className="tc2__m-close" onClick={closeModal} type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>

                {renderConfig()}

                <button className="tc2__m-confirm" onClick={confirmAdd} type="button">
                  Add to {modalSide === 'offer' ? 'Offering' : 'Requesting'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
