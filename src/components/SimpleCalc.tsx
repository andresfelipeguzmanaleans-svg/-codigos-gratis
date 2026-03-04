import { useState, useMemo, useCallback, useRef } from 'react';

/* ================================================================
   Types
   ================================================================ */

export interface CalcItem {
  id: string;
  name: string;
  value: number;
  rarity: string;
  category: string;
  imageUrl: string | null;
}

interface Props {
  items: CalcItem[];
  categories: string[];
  valueUnit?: string;
  rarityColors?: Record<string, string>;
}

interface SlotData {
  uid: number;
  id: string;
  qty: number;
}

/* ================================================================
   Helpers
   ================================================================ */

const SLOT_COUNT = 9;

const DEFAULT_COLORS: Record<string, string> = {
  common: '#9ca3af', Common: '#9ca3af',
  uncommon: '#84cc16', Uncommon: '#84cc16',
  rare: '#3b82f6', Rare: '#3b82f6',
  ultra_rare: '#a855f7', 'Ultra Rare': '#a855f7',
  legendary: '#fbbf24', Legendary: '#fbbf24',
  mythical: '#a855f7', Mythical: '#a855f7',
  epic: '#ec4899', Epic: '#ec4899',
  Limited: '#ef4444', Gamepass: '#22c55e',
  Ancient: '#8b5cf6', Godly: '#d946a8', Chroma: '#e23cdc',
  Vintage: '#b8962e', Pet: '#c2410c', Misc: '#6d28d9',
  Divine: '#fbbf24', Prismatic: '#e23cdc',
};

function fmt(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

function rarityGrad(rarity: string, colors: Record<string, string>): string {
  const c = colors[rarity] || DEFAULT_COLORS[rarity] || '#666';
  return `linear-gradient(180deg, ${c}30 0%, ${c}12 40%, rgba(17,17,17,0.95) 100%)`;
}

function getColor(rarity: string, colors: Record<string, string>): string {
  return colors[rarity] || DEFAULT_COLORS[rarity] || '#666';
}

/* ================================================================
   Component
   ================================================================ */

export default function SimpleCalc({ items, categories, valueUnit = 'Value', rarityColors = {} }: Props) {
  const uidRef = useRef(0);
  const colors = { ...DEFAULT_COLORS, ...rarityColors };

  const [offer, setOffer] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));
  const [request, setRequest] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSide, setModalSide] = useState<'offer' | 'request'>('offer');
  const [modalSlot, setModalSlot] = useState(0);
  const [modalCat, setModalCat] = useState('all');
  const [modalQuery, setModalQuery] = useState('');

  const [cfgItem, setCfgItem] = useState<string | null>(null);
  const [cfgQty, setCfgQty] = useState(1);
  const [swapping, setSwapping] = useState(false);

  const itemMap = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const slotValue = useCallback((slot: SlotData | null): number => {
    if (!slot) return 0;
    const item = itemMap.get(slot.id);
    return item ? item.value * slot.qty : 0;
  }, [itemMap]);

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

  // Actions
  const openModal = useCallback((side: 'offer' | 'request', idx: number) => {
    setModalSide(side); setModalSlot(idx); setModalCat('all'); setModalQuery(''); setCfgItem(null); setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => { setModalOpen(false); setCfgItem(null); }, []);

  const confirmAdd = useCallback(() => {
    if (!cfgItem) return;
    const slot: SlotData = { uid: uidRef.current++, id: cfgItem, qty: cfgQty };
    const setter = modalSide === 'offer' ? setOffer : setRequest;
    setter(prev => prev.map((s, i) => i === modalSlot ? slot : s));
    closeModal();
  }, [cfgItem, cfgQty, modalSide, modalSlot, closeModal]);

  const removeSlot = useCallback((side: 'offer' | 'request', idx: number) => {
    (side === 'offer' ? setOffer : setRequest)(prev => prev.map((s, i) => i === idx ? null : s));
  }, []);

  const swapSides = useCallback(() => {
    setSwapping(true);
    setTimeout(() => { const o = offer; setOffer(request); setRequest(o); setSwapping(false); }, 400);
  }, [offer, request]);

  const clearAll = useCallback(() => {
    setOffer(Array(SLOT_COUNT).fill(null)); setRequest(Array(SLOT_COUNT).fill(null));
  }, []);

  const modalItems = useMemo(() => {
    let list = items;
    if (modalCat !== 'all') list = list.filter(i => i.category === modalCat);
    const q = modalQuery.toLowerCase().trim();
    if (q) list = list.filter(i => i.name.toLowerCase().includes(q));
    return list.slice(0, 80);
  }, [items, modalCat, modalQuery]);

  // Render zone
  const renderZone = (side: 'offer' | 'request', slots: (SlotData | null)[], sideTotal: number) => {
    const isOffer = side === 'offer';
    const accent = isOffer ? '#22d3ee' : '#818cf8';
    const filled = slots.filter(Boolean).length;

    return (
      <div className={`tc2__zone${swapping ? (isOffer ? ' tc2__zone--swap-r' : ' tc2__zone--swap-l') : ''}`}>
        <div className="tc2__zone-head">
          <span className="tc2__zone-label" style={{ color: accent }}>{isOffer ? 'OFFERING' : 'REQUESTING'}</span>
          <span className="tc2__zone-count">{filled}/{SLOT_COUNT}</span>
        </div>
        <div className="tc2__slots">
          {slots.map((slot, idx) =>
            slot ? (() => {
              const item = itemMap.get(slot.id);
              const rarity = item?.rarity || '';
              return (
                <div key={slot.uid} className="tc2__slot tc2__slot--filled" style={{ background: rarityGrad(rarity, colors) }}>
                  <div className="tc2__slot-img-wrap">
                    {item?.imageUrl ? (
                      <img className="tc2__slot-img" src={item.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="tc2__slot-dot" style={{ background: getColor(rarity, colors) }} />
                    )}
                  </div>
                  {slot.qty > 1 && <span className="tc2__slot-qty">x{slot.qty}</span>}
                  <div className="tc2__slot-val">{fmt(slotValue(slot))}</div>
                  <div className="tc2__slot-name">{item?.name || '?'}</div>
                  <button className="tc2__slot-rm" onClick={() => removeSlot(side, idx)} type="button" title="Remove">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
              );
            })() : (
              <button key={`e${idx}`} className="tc2__slot tc2__slot--empty" onClick={() => openModal(side, idx)} type="button">
                <svg className="tc2__slot-plus" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              </button>
            )
          )}
        </div>
        <div className="tc2__zone-total" style={{ borderLeftColor: accent }}>
          <span className="tc2__zone-total-lbl">{valueUnit.toUpperCase()}</span>
          <span className="tc2__zone-total-num" style={{ color: accent }}>{fmt(sideTotal)}</span>
        </div>
      </div>
    );
  };

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
            <div className="tc2__gauge-dot" style={{ top: `${100 - offerPct}%`, background: verdictColor, boxShadow: `0 0 10px ${verdictColor}` }} />
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

      {/* Modal */}
      {modalOpen && (
        <div className="tc2__overlay" onClick={closeModal}>
          <div className="tc2__modal" onClick={e => e.stopPropagation()}>
            {!cfgItem ? (
              <>
                <div className="tc2__m-head">
                  <h3 className="tc2__m-title">Select Item</h3>
                  <button className="tc2__m-close" onClick={closeModal} type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                <div className="tc2__m-search">
                  <svg className="tc2__m-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <input className="tc2__m-search-input" type="text" placeholder="Search items..." value={modalQuery} onChange={e => setModalQuery(e.target.value)} autoFocus />
                </div>
                <div className="tc2__m-cats">
                  <button className={`tc2__m-cat${modalCat === 'all' ? ' tc2__m-cat--on' : ''}`} onClick={() => setModalCat('all')} type="button">All</button>
                  {categories.map(cat => (
                    <button key={cat} className={`tc2__m-cat${modalCat === cat ? ' tc2__m-cat--on' : ''}`} onClick={() => setModalCat(cat)} type="button">{cat}</button>
                  ))}
                </div>
                <div className="tc2__m-grid">
                  {modalItems.map(item => (
                    <button key={item.id} className="tc2__m-item" style={{ background: rarityGrad(item.rarity, colors) }} onClick={() => { setCfgItem(item.id); setCfgQty(1); }} type="button">
                      <div className="tc2__m-item-imgbox">
                        {item.imageUrl ? (
                          <img className="tc2__m-item-img" src={item.imageUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="tc2__m-item-dot" style={{ background: getColor(item.rarity, colors) }} />
                        )}
                      </div>
                      <span className="tc2__m-item-name">{item.name}</span>
                      <span className="tc2__m-item-val">{fmt(item.value)}</span>
                    </button>
                  ))}
                  {modalItems.length === 0 && <div className="tc2__m-empty">No items found</div>}
                </div>
              </>
            ) : (
              <>
                <div className="tc2__m-head">
                  <button className="tc2__m-back" onClick={() => setCfgItem(null)} type="button">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
                  </button>
                  <h3 className="tc2__m-title">Configure</h3>
                  <button className="tc2__m-close" onClick={closeModal} type="button">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                </div>
                {(() => {
                  const item = itemMap.get(cfgItem);
                  if (!item) return null;
                  const preview = item.value * cfgQty;
                  return (
                    <div className="tc2__cfg">
                      <div className="tc2__cfg-card" style={{ background: rarityGrad(item.rarity, colors) }}>
                        {item.imageUrl && <img className="tc2__cfg-img" src={item.imageUrl} alt="" />}
                        <div className="tc2__cfg-info">
                          <span className="tc2__cfg-name">{item.name}</span>
                          <span className="tc2__cfg-rarity" style={{ color: getColor(item.rarity, colors) }}>{item.rarity}</span>
                          <span className="tc2__cfg-base">{fmt(item.value)} {valueUnit}</span>
                        </div>
                      </div>
                      <div className="tc2__cfg-qty-row">
                        <span className="tc2__cfg-lbl">Quantity</span>
                        <div className="tc2__cfg-qty">
                          <button className="tc2__cfg-qty-btn" type="button" disabled={cfgQty <= 1} onClick={() => setCfgQty(q => Math.max(1, q - 1))}>-</button>
                          <span className="tc2__cfg-qty-num">{cfgQty}</span>
                          <button className="tc2__cfg-qty-btn" type="button" disabled={cfgQty >= 4} onClick={() => setCfgQty(q => Math.min(4, q + 1))}>+</button>
                        </div>
                      </div>
                      <div className="tc2__cfg-preview-val">Total: <strong>{fmt(preview)} {valueUnit}</strong></div>
                    </div>
                  );
                })()}
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
