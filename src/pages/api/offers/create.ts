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

  const { listingId, type, offerItems, requestItems } = body;

  if (!listingId || !type || !['counter', 'match'].includes(type)) {
    return new Response(JSON.stringify({ error: 'listingId and valid type required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (type === 'counter') {
    const allItems = [...(offerItems || []), ...(requestItems || [])];
    if (allItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Counter offer needs at least one item' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      runtimeEnv('PUBLIC_SUPABASE_URL') || import.meta.env.PUBLIC_SUPABASE_URL,
      runtimeEnv('SUPABASE_SECRET_KEY') || import.meta.env.SUPABASE_SECRET_KEY,
    );

    // Verify listing exists, is active, and user is not the owner
    const { data: listing } = await supabase
      .from('listings')
      .select('id, user_id, status, open_to_offers, listing_items(side)')
      .eq('id', listingId)
      .single();

    if (!listing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (listing.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Listing is not active' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (listing.user_id === session.userId) {
      return new Response(JSON.stringify({ error: 'Cannot offer on your own listing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (type === 'match') {
      const sides = new Set((listing.listing_items || []).map((i: any) => i.side));
      if (!sides.has('offer') || !sides.has('request')) {
        return new Response(JSON.stringify({ error: 'Match trade requires listing with both sides' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Create the offer
    const { data: offer, error: offerErr } = await supabase
      .from('offers')
      .insert({
        listing_id: listingId,
        user_id: session.userId,
        type,
        status: 'pending',
      })
      .select('id, type, status')
      .single();

    if (offerErr || !offer) {
      console.error('Offer insert error:', offerErr);
      return new Response(JSON.stringify({ error: offerErr?.message || 'Failed to create offer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Insert offer items for counter offers
    if (type === 'counter') {
      const items = [
        ...(offerItems || []).map((s: any) => ({
          offer_id: offer.id,
          side: 'offer',
          item_slug: s.slug,
          item_type: s.itemType,
          item_name: s.name,
          quantity: s.quantity || 1,
        })),
        ...(requestItems || []).map((s: any) => ({
          offer_id: offer.id,
          side: 'request',
          item_slug: s.slug,
          item_type: s.itemType,
          item_name: s.name,
          quantity: s.quantity || 1,
        })),
      ];

      if (items.length > 0) {
        const { error: itemsErr } = await supabase
          .from('offer_items')
          .insert(items);

        if (itemsErr) {
          console.error('Offer items insert error:', itemsErr);
          return new Response(JSON.stringify({ error: itemsErr.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    return new Response(JSON.stringify({ offer }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Create offer error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
