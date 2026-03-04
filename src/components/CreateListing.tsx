import { useState, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { SessionUser } from './AuthButton';

interface ItemInfo {
  slug: string;
  name: string;
  imageUrl?: string;
  tradeValue?: number;
  rarity?: string;
  itemType: string;
}

interface Props {
  allItems: ItemInfo[];
  user: SessionUser;
  onClose: () => void;
  onCreated: () => void;
}

interface SlotData {
  uid: number;
  slug: string;
  name: string;
  imageUrl?: string;
  rarity?: string;
  itemType: string;
  quantity: number;
}

const SLOT_COUNT = 6;

const RARITY_COLORS: Record<string, string> = {
  Limited: '#ef4444', Robux: '#22c55e', Regular: '#3b82f6', Code: '#f59e0b',
  Egg: '#ec4899', Merch: '#a855f7', 'Pirate Faction': '#f97316', Challenge: '#06b6d4',
  'Friend Quest': '#8b5cf6', DLC: '#14b8a6', Event: '#f43f5e', Exclusive: '#fbbf24',
  'Skin Merchant': '#c084fc',
};

function rarityGrad(rarity?: string): string {
  const c = RARITY_COLORS[rarity || ''] || '#333';
  return `linear-gradient(180deg, ${c}25 0%, ${c}08 50%, rgba(20,20,20,0.95) 100%)`;
}

export default function CreateListing({ allItems, user, onClose, onCreated }: Props) {
  const uidRef = useRef(0);

  const [listingType, setListingType] = useState<'offering' | 'wanting'>('offering');
  const [openToOffers, setOpenToOffers] = useState(true);
  const [offerSlots, setOfferSlots] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));
  const [requestSlots, setRequestSlots] = useState<(SlotData | null)[]>(Array(SLOT_COUNT).fill(null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSide, setPickerSide] = useState<'offer' | 'request'>('offer');
  const [pickerSlot, setPickerSlot] = useState(0);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerCat, setPickerCat] = useState<'all' | 'boat' | 'rod_skin'>('all');

  const filteredItems = useMemo(() => {
    let items = allItems;
    if (pickerCat !== 'all') items = items.filter(i => i.itemType === pickerCat);
    const q = pickerQuery.toLowerCase().trim();
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
    return items;
  }, [allItems, pickerCat, pickerQuery]);

  const openPicker = useCallback((side: 'offer' | 'request', idx: number) => {
    setPickerSide(side);
    setPickerSlot(idx);
    setPickerQuery('');
    setPickerCat('all');
    setPickerOpen(true);
  }, []);

  const selectItem = useCallback((item: ItemInfo) => {
    const slot: SlotData = {
      uid: uidRef.current++,
      slug: item.slug,
      name: item.name,
      imageUrl: item.imageUrl,
      rarity: item.rarity,
      itemType: item.itemType,
      quantity: 1,
    };
    const setter = pickerSide === 'offer' ? setOfferSlots : setRequestSlots;
    setter(prev => prev.map((s, i) => i === pickerSlot ? slot : s));
    setPickerOpen(false);
  }, [pickerSide, pickerSlot]);

  const removeSlot = useCallback((side: 'offer' | 'request', idx: number) => {
    const setter = side === 'offer' ? setOfferSlots : setRequestSlots;
    setter(prev => prev.map((s, i) => i === idx ? null : s));
  }, []);

  const offerCount = offerSlots.filter(Boolean).length;
  const requestCount = requestSlots.filter(Boolean).length;
  const canSubmit = offerCount > 0 || requestCount > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      // Create listing
      const { data: listing, error: listingErr } = await supabase
        .from('listings')
        .insert({
          user_id: user.id,
          type: listingType,
          status: 'active',
          open_to_offers: openToOffers,
        })
        .select('id')
        .single();

      if (listingErr || !listing) {
        throw new Error(listingErr?.message || 'Failed to create listing');
      }

      // Insert items
      const items = [
        ...offerSlots.filter(Boolean).map((s) => ({
          listing_id: listing.id,
          side: 'offer' as const,
          item_slug: s!.slug,
          item_type: s!.itemType,
          item_name: s!.name,
          quantity: s!.quantity,
          weight: null,
          mutation: null,
        })),
        ...requestSlots.filter(Boolean).map((s) => ({
          listing_id: listing.id,
          side: 'request' as const,
          item_slug: s!.slug,
          item_type: s!.itemType,
          item_name: s!.name,
          quantity: s!.quantity,
          weight: null,
          mutation: null,
        })),
      ];

      if (items.length > 0) {
        const { error: itemsErr } = await supabase
          .from('listing_items')
          .insert(items);

        if (itemsErr) {
          throw new Error(itemsErr.message);
        }
      }

      onCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create listing');
    } finally {
      setSubmitting(false);
    }
  };

  const renderSlots = (side: 'offer' | 'request', slots: (SlotData | null)[]) => (
    <div className="cl__slots">
      {slots.map((slot, idx) =>
        slot ? (
          <div key={slot.uid} className="cl__slot cl__slot--filled" style={{ background: rarityGrad(slot.rarity) }}>
            {slot.imageUrl ? (
              <img className="cl__slot-img" src={slot.imageUrl} alt="" loading="lazy" />
            ) : (
              <div className="cl__slot-ph" />
            )}
            <span className="cl__slot-name">{slot.name}</span>
            <button className="cl__slot-rm" onClick={() => removeSlot(side, idx)} type="button">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        ) : (
          <button key={`e${idx}`} className="cl__slot cl__slot--empty" onClick={() => openPicker(side, idx)} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </button>
        )
      )}
    </div>
  );

  return (
    <div className="cl__overlay" onClick={onClose}>
      <div className="cl__modal" onClick={e => e.stopPropagation()}>
        <div className="cl__head">
          <h3 className="cl__title">Create Listing</h3>
          <button className="cl__close" onClick={onClose} type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Type selector */}
        <div className="cl__type-row">
          <button
            className={`cl__type-btn${listingType === 'offering' ? ' cl__type-btn--on' : ''}`}
            onClick={() => setListingType('offering')}
            type="button"
          >Offering</button>
          <button
            className={`cl__type-btn${listingType === 'wanting' ? ' cl__type-btn--on' : ''}`}
            onClick={() => setListingType('wanting')}
            type="button"
          >Wanting</button>
        </div>

        {/* Two sides */}
        <div className="cl__sides">
          <div className="cl__side">
            <span className="cl__side-label" style={{ color: '#22d3ee' }}>Offering ({offerCount}/{SLOT_COUNT})</span>
            {renderSlots('offer', offerSlots)}
          </div>
          <div className="cl__arrow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
          </div>
          <div className="cl__side">
            <span className="cl__side-label" style={{ color: '#818cf8' }}>Wanting ({requestCount}/{SLOT_COUNT})</span>
            {renderSlots('request', requestSlots)}
          </div>
        </div>

        {/* Open to offers toggle */}
        <label className="cl__toggle">
          <input type="checkbox" checked={openToOffers} onChange={e => setOpenToOffers(e.target.checked)} />
          <span className="cl__toggle-slider" />
          <span className="cl__toggle-text">Open to counter-offers</span>
        </label>

        {error && <div className="cl__error">{error}</div>}

        <button
          className="cl__submit"
          disabled={!canSubmit || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting ? 'Creating...' : 'Create Listing'}
        </button>
      </div>

      {/* Item Picker Sub-modal */}
      {pickerOpen && (
        <div className="cl__picker-overlay" onClick={() => setPickerOpen(false)}>
          <div className="cl__picker" onClick={e => e.stopPropagation()}>
            <div className="cl__picker-head">
              <h4 className="cl__picker-title">Select Item</h4>
              <button className="cl__close" onClick={() => setPickerOpen(false)} type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>

            <div className="cl__picker-search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input
                type="text"
                placeholder="Search..."
                value={pickerQuery}
                onChange={e => setPickerQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="cl__picker-cats">
              {([['all', 'All'], ['boat', 'Boats'], ['rod_skin', 'Rod Skins']] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={`cl__picker-cat${pickerCat === key ? ' cl__picker-cat--on' : ''}`}
                  onClick={() => setPickerCat(key)}
                  type="button"
                >{label}</button>
              ))}
            </div>

            <div className="cl__picker-grid">
              {filteredItems.slice(0, 60).map(item => (
                <button
                  key={item.slug}
                  className="cl__picker-item"
                  style={{ background: rarityGrad(item.rarity) }}
                  onClick={() => selectItem(item)}
                  type="button"
                >
                  {item.imageUrl ? (
                    <img className="cl__picker-item-img" src={item.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="cl__picker-item-ph" />
                  )}
                  <span className="cl__picker-item-name">{item.name}</span>
                </button>
              ))}
              {filteredItems.length === 0 && <div className="cl__picker-empty">No items found</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
