import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ── Types ── */

export interface User {
  id: string;
  roblox_id: number;
  roblox_username: string;
  roblox_avatar_url: string | null;
  display_name: string | null;
  created_at: string;
  last_login: string;
  is_banned: boolean;
}

export interface Listing {
  id: string;
  user_id: string;
  type: 'offering' | 'wanting';
  status: 'active' | 'in_progress' | 'completed' | 'cancelled';
  open_to_offers: boolean;
  created_at: string;
  updated_at: string;
  user?: User;
  listing_items?: ListingItem[];
}

export interface ListingItem {
  id: string;
  listing_id: string;
  side: 'offer' | 'request';
  item_slug: string;
  item_type: 'boat' | 'rod_skin' | 'fish';
  item_name: string;
  quantity: number;
  weight: number | null;
  mutation: string | null;
}

export interface MarketStats {
  most_traded_slug: string;
  most_traded_name: string;
  most_traded_count: number;
  most_wanted_slug: string;
  most_wanted_name: string;
  most_wanted_count: number;
  most_offered_slug: string;
  most_offered_name: string;
  most_offered_count: number;
  active_listings_30d: number;
  updated_at: string;
}
