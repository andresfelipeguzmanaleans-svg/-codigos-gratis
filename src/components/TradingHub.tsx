import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Listing, ListingItem, MarketStats } from '../lib/supabase';
import AuthButton from './AuthButton';
import type { SessionUser } from './AuthButton';
import CreateListing from './CreateListing';

/* ================================================================
   Types
   ================================================================ */

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
  user?: { roblox_username: string; roblox_avatar_url: string | null };
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
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [openToOffers, setOpenToOffers] = useState(false);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const itemMap = useMemo(() => new Map(allItems.map(i => [i.slug, i])), [allItems]);

  // Fetch listings
  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('listings')
        .select('*, listing_items(*), user:users(roblox_username, roblox_avatar_url)')
        .order('created_at', { ascending: sortBy === 'oldest' });

      if (tab !== 'all') {
        query = query.eq('type', tab);
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (openToOffers) {
        query = query.eq('open_to_offers', true);
      }

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
  }, [tab, statusFilter, sortBy, openToOffers]);

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
      } catch {
        // stats not available yet
      }
    }
    loadStats();
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Get items for a listing side
  const getItemsBySide = (listing: ListingWithItems, side: 'offer' | 'request') => {
    return (listing.listing_items || []).filter(i => i.side === side);
  };

  const getTotalValue = (items: ListingItem[]) => {
    return items.reduce((sum, li) => {
      const info = itemMap.get(li.item_slug);
      return sum + (info?.tradeValue || 0) * li.quantity;
    }, 0);
  };

  const handleCreateClick = () => {
    if (!user) {
      window.location.href = '/api/auth/login';
      return;
    }
    setShowCreate(true);
  };

  const handleListingCreated = () => {
    setShowCreate(false);
    fetchListings();
  };

  /* ================================================================
     Render
     ================================================================ */

  return (
    <div className="th">
      {/* Auth + Stats row */}
      <div className="th__top-row">
        <AuthButton onUserChange={setUser} />
      </div>

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
                checked={openToOffers}
                onChange={e => setOpenToOffers(e.target.checked)}
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

          return (
            <div key={listing.id} className="th__listing">
              <div className="th__listing-head">
                <div className="th__listing-user">
                  {listing.user?.roblox_avatar_url ? (
                    <img className="th__listing-avatar" src={listing.user.roblox_avatar_url} alt="" />
                  ) : (
                    <div className="th__listing-avatar th__listing-avatar--ph">?</div>
                  )}
                  <span className="th__listing-username">{listing.user?.roblox_username || 'Unknown'}</span>
                </div>
                <div className="th__listing-meta">
                  <span className={`th__listing-type th__listing-type--${listing.type}`}>
                    {listing.type === 'offering' ? 'OFFERING' : 'WANTING'}
                  </span>
                  <span className="th__listing-time">{timeAgo(listing.created_at)}</span>
                </div>
              </div>

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

              <div className="th__listing-foot">
                <span className={`th__listing-status th__listing-status--${listing.status}`}>
                  {listing.status === 'in_progress' ? 'In Progress' : listing.status.charAt(0).toUpperCase() + listing.status.slice(1)}
                </span>
                {listing.open_to_offers && (
                  <span className="th__listing-offers-tag">Open to Offers</span>
                )}
              </div>
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
    </div>
  );
}
