import type { APIRoute } from 'astro';

function runtimeEnv(key: string): string | undefined {
  const g = globalThis as Record<string, any>;
  return g['process']?.['env']?.[key];
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getSession(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = parseCookie(cookieHeader, 'session');
  if (!token) return null;

  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return payload as { userId: string; robloxId: number; username: string };
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request }) => {
  const session = getSession(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { type, openToOffers, offerItems, requestItems } = body;

  if (!type || !['offering', 'wanting'].includes(type)) {
    return new Response(JSON.stringify({ error: 'Invalid listing type' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const allItems = [...(offerItems || []), ...(requestItems || [])];
  if (allItems.length === 0) {
    return new Response(JSON.stringify({ error: 'At least one item is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      runtimeEnv('PUBLIC_SUPABASE_URL') || import.meta.env.PUBLIC_SUPABASE_URL,
      runtimeEnv('SUPABASE_SECRET_KEY') || import.meta.env.SUPABASE_SECRET_KEY,
    );

    // Insert listing
    const { data: listing, error: listingErr } = await supabase
      .from('listings')
      .insert({
        user_id: session.userId,
        type,
        status: 'active',
        open_to_offers: openToOffers ?? true,
      })
      .select('id')
      .single();

    if (listingErr || !listing) {
      console.error('Listing insert error:', listingErr);
      return new Response(JSON.stringify({ error: listingErr?.message || 'Failed to create listing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Insert items
    const items = [
      ...(offerItems || []).map((s: any) => ({
        listing_id: listing.id,
        side: 'offer',
        item_slug: s.slug,
        item_type: s.itemType,
        item_name: s.name,
        quantity: s.quantity || 1,
        weight: null,
        mutation: null,
      })),
      ...(requestItems || []).map((s: any) => ({
        listing_id: listing.id,
        side: 'request',
        item_slug: s.slug,
        item_type: s.itemType,
        item_name: s.name,
        quantity: s.quantity || 1,
        weight: null,
        mutation: null,
      })),
    ];

    if (items.length > 0) {
      const { error: itemsErr } = await supabase
        .from('listing_items')
        .insert(items);

      if (itemsErr) {
        console.error('Listing items insert error:', itemsErr);
        return new Response(JSON.stringify({ error: itemsErr.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ id: listing.id }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Create listing error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
