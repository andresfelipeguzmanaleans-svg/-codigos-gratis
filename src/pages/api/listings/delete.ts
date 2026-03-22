import type { APIRoute } from 'astro';
import { runtimeEnv, getSession, isValidUUID } from '../../../lib/auth';

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

  const { listingId } = body;
  if (!isValidUUID(listingId)) {
    return new Response(JSON.stringify({ error: 'Valid listingId (UUID) required' }), {
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

    // Verify ownership
    const { data: listing } = await supabase
      .from('listings')
      .select('id, user_id')
      .eq('id', listingId)
      .single();

    if (!listing) {
      return new Response(JSON.stringify({ error: 'Listing not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (listing.user_id !== session.userId) {
      return new Response(JSON.stringify({ error: 'Not your listing' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Delete (CASCADE removes listing_items, offers, offer_items, comments)
    const { error: err } = await supabase
      .from('listings')
      .delete()
      .eq('id', listingId);

    if (err) {
      console.error('Delete listing error:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Delete listing error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
