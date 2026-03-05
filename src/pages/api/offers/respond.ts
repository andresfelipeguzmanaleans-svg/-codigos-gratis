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

  const { offerId, action } = body;

  if (!offerId || !action || !['accept', 'reject'].includes(action)) {
    return new Response(JSON.stringify({ error: 'offerId and valid action required' }), {
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

    // Get the offer with its listing
    const { data: offer } = await supabase
      .from('offers')
      .select('id, listing_id, status, listing:listings(user_id)')
      .eq('id', offerId)
      .single();

    if (!offer) {
      return new Response(JSON.stringify({ error: 'Offer not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (offer.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'Offer already resolved' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify the current user owns the listing
    const listingOwnerId = (offer.listing as any)?.user_id;
    if (listingOwnerId !== session.userId) {
      return new Response(JSON.stringify({ error: 'Only the listing owner can respond' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();

    if (action === 'accept') {
      // Accept this offer
      await supabase
        .from('offers')
        .update({ status: 'accepted', resolved_at: now })
        .eq('id', offerId);

      // Reject all other pending offers on the same listing
      await supabase
        .from('offers')
        .update({ status: 'rejected', resolved_at: now })
        .eq('listing_id', offer.listing_id)
        .neq('id', offerId)
        .eq('status', 'pending');

      // Mark listing as completed
      await supabase
        .from('listings')
        .update({ status: 'completed', updated_at: now })
        .eq('id', offer.listing_id);
    } else {
      // Reject this offer
      await supabase
        .from('offers')
        .update({ status: 'rejected', resolved_at: now })
        .eq('id', offerId);
    }

    return new Response(JSON.stringify({ offer: { id: offerId, status: action === 'accept' ? 'accepted' : 'rejected' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Offer respond error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
