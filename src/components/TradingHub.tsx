import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Listing, ListingItem, MarketStats, ListingComment, Offer, OfferItem } from '../lib/supabase';
import CreateListing from './CreateListing';
import MakeOffer from './MakeOffer';

interface SessionUser {
  id: string;
  robloxId: number;
  username: string;
  avatar: string | null;
  displayName: string | null;
}

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
}

type Tab = 'all' | 'offering' | 'wanting';
type StatusFilter = 'active' | 'in_progress' | 'completed' | 'all';
type SortBy = 'newest' | 'oldest' | 'value';

interface ListingWithItems extends Listing {
  listing_items: ListingItem[];
  user?: { id?: string; roblox_username: string; roblox_avatar_url: string | null };
}

/* ================================================================
   Helpers
   ================================================================ */

const RARITY_COLORS: Record<string, string> = {
  Limited: '#ef4444', Robux: '#22c55e', Regular: '#3b82f6', Code: '#f59e0b',
  Egg: '#ec4899', Merch: '#a855f7', 'Pirate Faction': '#f97316', Challenge: '#06b6d4',
  'Friend Quest': '#8b5cf6', DLC: '#14b8a6', Event: '#f43f5e', Exclusive: '#fbbf24',
  'Skin Merchant': '#c084fc',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtVal(n: number | undefined): string {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

/* ================================================================
   Component
   ================================================================ */

export default function TradingHub({ allItems }: Props) {
  const [listings, setListings] = useState<ListingWithItems[]>([]);
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [openToOffersFilter, setOpenToOffersFilter] = useState(false);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Expand state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, ListingComment[]>>({});
  const [offers, setOffers] = useState<Record<string, Offer[]>>({});
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Make offer modal
  const [makeOfferListingId, setMakeOfferListingId] = useState<string | null>(null);

  const itemMap = useMemo(() => new Map(allItems.map(i => [i.slug, i])), [allItems]);

  // Fetch user session
  useEffect(() => {
    fetch('/api/auth/me/')
      .then(res => res.json())
      .then(data => setUser(data.user || null))
      .catch(() => setUser(null));
  }, []);

  // Fetch listings
  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('listings')
        .select('*, listing_items(*), user:users(id, roblox_username, roblox_avatar_url)')
        .order('created_at', { ascending: sortBy === 'oldest' });

      if (tab !== 'all') query = query.eq('type', tab);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (openToOffersFilter) query = query.eq('open_to_offers', true);

      const { data, error: err } = await query.limit(50);

      if (err) {
        console.warn('Supabase query error:', err.message);
        setListings([]);
      } else {
        setListings((data as ListingWithItems[]) || []);
      }
    } catch (e) {
      console.warn('Failed to fetch listings:', e);
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [tab, statusFilter, sortBy, openToOffersFilter]);

  // Fetch stats
  useEffect(() => {
    async function loadStats() {
      try {
        const { data } = await supabase
          .from('market_stats')
          .select('*')
          .eq('id', 1)
          .single();
        if (data) setStats(data as MarketStats);
      } catch {}
    }
    loadStats();
  }, []);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const getItemsBySide = (listing: ListingWithItems, side: 'offer' | 'request') =>
    (listing.listing_items || []).filter(i => i.side === side);

  const getTotalValue = (items: ListingItem[]) =>
    items.reduce((sum, li) => {
      const info = itemMap.get(li.item_slug);
      return sum + (info?.tradeValue || 0) * li.quantity;
    }, 0);

  const handleCreateClick = () => {
    if (!user) {
      window.location.href = `/api/auth/login/?return_to=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setShowCreate(true);
  };

  const handleListingCreated = () => {
    setShowCreate(false);
    fetchListings();
  };

  /* ── Expand / Collapse ── */

  const toggleExpand = async (listingId: string) => {
    if (expandedId === listingId) {
      setExpandedId(null);
      setCommentText('');
      return;
    }
    setExpandedId(listingId);
    setCommentText('');

    // Increment views (fire-and-forget)
    fetch('/api/listings/view/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
    }).catch(() => {});

    // Load comments
    if (!comments[listingId]) {
      const { data } = await supabase
        .from('listing_comments')
        .select('*, user:users(roblox_username, roblox_avatar_url)')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: true });
      if (data) setComments(prev => ({ ...prev, [listingId]: data as ListingComment[] }));
    }

    // Load offers
    if (!offers[listingId]) {
      const { data } = await supabase
        .from('offers')
        .select('*, user:users(roblox_username, roblox_avatar_url), offer_items(*)')
        .eq('listing_id', listingId)
        .order('created_at', { ascending: false });
      if (data) setOffers(prev => ({ ...prev, [listingId]: data as Offer[] }));
    }
  };

  /* ── Comments ── */

  const postComment = async (listingId: string) => {
    if (!commentText.trim() || postingComment) return;
    setPostingComment(true);
    try {
      const res = await fetch('/api/listings/comments/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, body: commentText.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.comment) {
        setComments(prev => ({
          ...prev,
          [listingId]: [...(prev[listingId] || []), data.comment],
        }));
        setCommentText('');
        // Update local count
        setListings(prev => prev.map(l =>
          l.id === listingId ? { ...l, comments_count: (l.comments_count || 0) + 1 } : l
        ));
      }
    } catch {} finally {
      setPostingComment(false);
    }
  };

  /* ── Match Trade ── */

  const matchTrade = async (listingId: string) => {
    if (!user) return;
    try {
      const res = await fetch('/api/offers/create/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, type: 'match' }),
      });
      const data = await res.json();
      if (res.ok) {
        // Refresh offers
        const { data: fresh } = await supabase
          .from('offers')
          .select('*, user:users(roblox_username, roblox_avatar_url), offer_items(*)')
          .eq('listing_id', listingId)
          .order('created_at', { ascending: false });
        if (fresh) setOffers(prev => ({ ...prev, [listingId]: fresh as Offer[] }));
      } else {
        alert(data.error || 'Failed to match trade');
      }
    } catch {}
  };

  /* ── Offer Response ── */

  const respondToOffer = async (offerId: string, listingId: string, action: 'accept' | 'reject') => {
    try {
      const res = await fetch('/api/offers/respond/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, action }),
      });
      if (res.ok) {
        // Refresh offers
        const { data: fresh } = await supabase
          .from('offers')
          .select('*, user:users(roblox_username, roblox_avatar_url), offer_items(*)')
          .eq('listing_id', listingId)
          .order('created_at', { ascending: false });
        if (fresh) setOffers(prev => ({ ...prev, [listingId]: fresh as Offer[] }));
        if (action === 'accept') fetchListings();
      }
    } catch {}
  };

  /* ── Make Offer callback ── */

  const handleOfferCreated = async () => {
    if (makeOfferListingId) {
      const { data: fresh } = await supabase
        .from('offers')
        .select('*, user:users(roblox_username, roblox_avatar_url), offer_items(*)')
        .eq('listing_id', makeOfferListingId)
        .order('created_at', { ascending: false });
      if (fresh) setOffers(prev => ({ ...prev, [makeOfferListingId!]: fresh as Offer[] }));
    }
    setMakeOfferListingId(null);
  };

  /* ================================================================
     Render
     ================================================================ */

  return (
    <div className="th">
      {/* Stats Dashboard */}
      <div className="th__stats">
        <div className="th__stat">
          <div className="th__stat-label">Most Traded</div>
          <div className="th__stat-value">{stats?.most_traded_name || '—'}</div>
          <div className="th__stat-count">{stats?.most_traded_count || 0} listings</div>
        </div>
        <div className="th__stat">
          <div className="th__stat-label">Most Wanted</div>
          <div className="th__stat-value">{stats?.most_wanted_name || '—'}</div>
          <div className="th__stat-count">{stats?.most_wanted_count || 0} seeking</div>
        </div>
        <div className="th__stat">
          <div className="th__stat-label">Most Offered</div>
          <div className="th__stat-value">{stats?.most_offered_name || '—'}</div>
          <div className="th__stat-count">{stats?.most_offered_count || 0} offering</div>
        </div>
        <div className="th__stat">
          <div className="th__stat-label">Active Listings</div>
          <div className="th__stat-value th__stat-value--big">{stats?.active_listings_30d || 0}</div>
          <div className="th__stat-count">past 30 days</div>
        </div>
      </div>

      {/* Create Listing CTA */}
      <button className="th__create-btn" type="button" onClick={handleCreateClick}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        {user ? 'Create Listing' : 'Login with Roblox to Trade'}
      </button>

      {/* Filters */}
      <div className="th__filters">
        <div className="th__tabs">
          {(['all', 'offering', 'wanting'] as Tab[]).map(t => (
            <button
              key={t}
              className={`th__tab${tab === t ? ' th__tab--on' : ''}`}
              onClick={() => setTab(t)}
              type="button"
            >
              {t === 'all' ? 'All' : t === 'offering' ? 'Offered' : 'Wanted'}
            </button>
          ))}
        </div>

        <div className="th__filter-row">
          <div className="th__status-filters">
            {(['active', 'in_progress', 'completed', 'all'] as StatusFilter[]).map(s => (
              <button
                key={s}
                className={`th__filter-btn${statusFilter === s ? ' th__filter-btn--on' : ''}`}
                onClick={() => setStatusFilter(s)}
                type="button"
              >
                {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          <div className="th__right-filters">
            <label className="th__toggle">
              <input
                type="checkbox"
                checked={openToOffersFilter}
                onChange={e => setOpenToOffersFilter(e.target.checked)}
              />
              <span className="th__toggle-slider" />
              <span className="th__toggle-label">Open to Offers</span>
            </label>

            <select
              className="th__sort"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortBy)}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>
        </div>
      </div>

      {/* Listings Grid */}
      <div className="th__listings">
        {loading && (
          <div className="th__empty">
            <div className="th__spinner" />
            <span>Loading listings...</span>
          </div>
        )}

        {!loading && listings.length === 0 && (
          <div className="th__empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.3 }}>
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <span className="th__empty-title">No listings yet</span>
            <span className="th__empty-desc">Be the first to create a trade listing!</span>
          </div>
        )}

        {!loading && listings.map(listing => {
          const offerItems = getItemsBySide(listing, 'offer');
          const requestItems = getItemsBySide(listing, 'request');
          const offerValue = getTotalValue(offerItems);
          const requestValue = getTotalValue(requestItems);
          const isExpanded = expandedId === listing.id;
          const isOwner = user?.id === listing.user_id;
          const hasBothSides = offerItems.length > 0 && requestItems.length > 0;
          const listingOffers = offers[listing.id] || [];
          const listingComments = comments[listing.id] || [];

          return (
            <div key={listing.id} className={`th__listing${isExpanded ? ' th__listing--expanded' : ''}`}>
              {/* Header - clickable to expand */}
              <div className="th__listing-head" onClick={() => toggleExpand(listing.id)} style={{ cursor: 'pointer' }}>
                <div className="th__listing-user">
                  {listing.user?.roblox_avatar_url ? (
                    <img className="th__listing-avatar" src={listing.user.roblox_avatar_url} alt="" />
                  ) : (
                    <div className="th__listing-avatar th__listing-avatar--ph">?</div>
                  )}
                  <span className="th__listing-username">{listing.user?.roblox_username || 'Unknown'}</span>
                </div>
                <div className="th__listing-meta">
                  <span className="th__listing-counter">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                    {listing.views_count || 0}
                  </span>
                  <span className="th__listing-counter">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {listing.comments_count || 0}
                  </span>
                  <span className={`th__listing-type th__listing-type--${listing.type}`}>
                    {listing.type === 'offering' ? 'OFFERING' : 'WANTING'}
                  </span>
                  <span className="th__listing-time">{timeAgo(listing.created_at)}</span>
                </div>
              </div>

              {/* Body */}
              <div className="th__listing-body">
                <div className="th__listing-side">
                  <span className="th__listing-side-label">Offering</span>
                  <div className="th__listing-items">
                    {offerItems.map(li => {
                      const info = itemMap.get(li.item_slug);
                      return (
                        <div key={li.id} className="th__listing-item">
                          {info?.imageUrl ? (
                            <img className="th__listing-item-img" src={info.imageUrl} alt="" loading="lazy" />
                          ) : (
                            <div className="th__listing-item-ph" />
                          )}
                          <div className="th__listing-item-info">
                            <span className="th__listing-item-name">{li.item_name}</span>
                            {li.quantity > 1 && <span className="th__listing-item-qty">x{li.quantity}</span>}
                          </div>
                        </div>
                      );
                    })}
                    {offerItems.length === 0 && <span className="th__listing-none">—</span>}
                  </div>
                  {offerValue > 0 && <span className="th__listing-total">{fmtVal(offerValue)} ER</span>}
                </div>

                <div className="th__listing-arrow">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m7 16-4-4 4-4"/><path d="M3 12h18"/><path d="m17 8 4 4-4 4"/></svg>
                </div>

                <div className="th__listing-side">
                  <span className="th__listing-side-label">Wanting</span>
                  <div className="th__listing-items">
                    {requestItems.map(li => {
                      const info = itemMap.get(li.item_slug);
                      return (
                        <div key={li.id} className="th__listing-item">
                          {info?.imageUrl ? (
                            <img className="th__listing-item-img" src={info.imageUrl} alt="" loading="lazy" />
                          ) : (
                            <div className="th__listing-item-ph" />
                          )}
                          <div className="th__listing-item-info">
                            <span className="th__listing-item-name">{li.item_name}</span>
                            {li.quantity > 1 && <span className="th__listing-item-qty">x{li.quantity}</span>}
                          </div>
                        </div>
                      );
                    })}
                    {requestItems.length === 0 && <span className="th__listing-none">—</span>}
                  </div>
                  {requestValue > 0 && <span className="th__listing-total">{fmtVal(requestValue)} ER</span>}
                </div>
              </div>

              {/* Footer */}
              <div className="th__listing-foot">
                <div className="th__listing-foot-left">
                  <span className={`th__listing-status th__listing-status--${listing.status}`}>
                    {listing.status === 'in_progress' ? 'In Progress' : listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
                  </span>
                  {listing.open_to_offers && (
                    <span className="th__listing-offers-tag">Open to Offers</span>
                  )}
                </div>
                {listing.status === 'active' && user && !isOwner && (
                  <div className="th__listing-actions">
                    {hasBothSides && (
                      <button className="th__listing-match-btn" type="button" onClick={e => { e.stopPropagation(); matchTrade(listing.id); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5"/></svg>
                        Match Trade
                      </button>
                    )}
                    {listing.open_to_offers && (
                      <button className="th__listing-offer-btn" type="button" onClick={e => { e.stopPropagation(); setMakeOfferListingId(listing.id); }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                        Make Offer
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded Section */}
              {isExpanded && (
                <div className="th__listing-expand">
                  {/* Offers Section */}
                  <div className="th__offers-section">
                    <div className="th__offers-header">
                      <span className="th__offers-title">Offers ({listingOffers.length})</span>
                    </div>

                    {listingOffers.length === 0 && (
                      <span className="th__offers-empty">No offers yet</span>
                    )}

                    {listingOffers.map(offer => (
                      <div key={offer.id} className={`th__offer-card th__offer-card--${offer.status}`}>
                        <div className="th__offer-head">
                          <div className="th__offer-user">
                            {offer.user?.roblox_avatar_url ? (
                              <img className="th__offer-avatar" src={offer.user.roblox_avatar_url} alt="" />
                            ) : (
                              <div className="th__offer-avatar th__offer-avatar--ph">?</div>
                            )}
                            <span className="th__offer-username">{offer.user?.roblox_username || 'Unknown'}</span>
                            <span className={`th__offer-type th__offer-type--${offer.type}`}>
                              {offer.type === 'match' ? 'MATCH' : 'COUNTER'}
                            </span>
                          </div>
                          <div className="th__offer-right">
                            <span className={`th__offer-status th__offer-status--${offer.status}`}>
                              {offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
                            </span>
                            <span className="th__offer-time">{timeAgo(offer.created_at)}</span>
                          </div>
                        </div>

                        {/* Counter offer items */}
                        {offer.type === 'counter' && offer.offer_items && offer.offer_items.length > 0 && (
                          <div className="th__offer-items">
                            <div className="th__offer-items-side">
                              {(offer.offer_items || []).filter(i => i.side === 'offer').map(oi => {
                                const info = itemMap.get(oi.item_slug);
                                return (
                                  <div key={oi.id} className="th__offer-item">
                                    {info?.imageUrl ? (
                                      <img className="th__offer-item-img" src={info.imageUrl} alt="" />
                                    ) : (
                                      <div className="th__offer-item-ph" />
                                    )}
                                    <span>{oi.item_name}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="th__offer-items-arrow">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                            </div>
                            <div className="th__offer-items-side">
                              {(offer.offer_items || []).filter(i => i.side === 'request').map(oi => {
                                const info = itemMap.get(oi.item_slug);
                                return (
                                  <div key={oi.id} className="th__offer-item">
                                    {info?.imageUrl ? (
                                      <img className="th__offer-item-img" src={info.imageUrl} alt="" />
                                    ) : (
                                      <div className="th__offer-item-ph" />
                                    )}
                                    <span>{oi.item_name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {offer.type === 'match' && (
                          <div className="th__offer-match-msg">Wants to match this trade as-is</div>
                        )}

                        {/* Accept/Reject for listing owner */}
                        {isOwner && offer.status === 'pending' && (
                          <div className="th__offer-actions">
                            <button className="th__offer-accept" type="button" onClick={() => respondToOffer(offer.id, listing.id, 'accept')}>Accept</button>
                            <button className="th__offer-reject" type="button" onClick={() => respondToOffer(offer.id, listing.id, 'reject')}>Reject</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Comments Section */}
                  <div className="th__comments-section">
                    <span className="th__comments-title">Comments ({listingComments.length})</span>

                    {listingComments.length === 0 && (
                      <span className="th__comments-empty">No comments yet</span>
                    )}

                    {listingComments.map(c => (
                      <div key={c.id} className="th__comment">
                        {c.user?.roblox_avatar_url ? (
                          <img className="th__comment-avatar" src={c.user.roblox_avatar_url} alt="" />
                        ) : (
                          <div className="th__comment-avatar th__comment-avatar--ph">?</div>
                        )}
                        <div className="th__comment-body">
                          <div className="th__comment-header">
                            <span className="th__comment-username">{c.user?.roblox_username || 'Unknown'}</span>
                            <span className="th__comment-time">{timeAgo(c.created_at)}</span>
                          </div>
                          <div className="th__comment-text">{c.body}</div>
                        </div>
                      </div>
                    ))}

                    {user ? (
                      <div className="th__comment-form">
                        <input
                          className="th__comment-input"
                          type="text"
                          placeholder="Write a comment..."
                          value={commentText}
                          onChange={e => setCommentText(e.target.value)}
                          maxLength={1000}
                          onKeyDown={e => { if (e.key === 'Enter') postComment(listing.id); }}
                        />
                        <button
                          className="th__comment-submit"
                          type="button"
                          disabled={!commentText.trim() || postingComment}
                          onClick={() => postComment(listing.id)}
                        >
                          {postingComment ? '...' : 'Send'}
                        </button>
                      </div>
                    ) : (
                      <div className="th__comment-login">
                        <a href={`/api/auth/login/?return_to=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}>Login</a> to comment
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create Listing Modal */}
      {showCreate && user && (
        <CreateListing
          allItems={allItems}
          user={user}
          onClose={() => setShowCreate(false)}
          onCreated={handleListingCreated}
        />
      )}

      {/* Make Offer Modal */}
      {makeOfferListingId && user && (
        <MakeOffer
          allItems={allItems}
          user={user}
          listingId={makeOfferListingId}
          onClose={() => setMakeOfferListingId(null)}
          onOfferCreated={handleOfferCreated}
        />
      )}
    </div>
  );
}
