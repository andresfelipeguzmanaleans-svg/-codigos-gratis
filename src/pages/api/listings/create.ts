import type { APIRoute } from 'astro';
import { runtimeEnv, getSession } from '../../../lib/auth';

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
  if (allItems.length === 0 || allItems.length > 50) {
    return new Response(JSON.stringify({ error: 'Items must be between 1 and 50' }), {
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
