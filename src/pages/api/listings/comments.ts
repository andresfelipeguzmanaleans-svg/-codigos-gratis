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

  const { listingId, body: commentBody } = body;

  if (!isValidUUID(listingId)) {
    return new Response(JSON.stringify({ error: 'Valid listingId (UUID) required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!commentBody || typeof commentBody !== 'string') {
    return new Response(JSON.stringify({ error: 'body required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trimmed = commentBody.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) {
    return new Response(JSON.stringify({ error: 'Comment must be 1-1000 characters' }), {
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

    const { data: comment, error: err } = await supabase
      .from('listing_comments')
      .insert({
        listing_id: listingId,
        user_id: session.userId,
        body: trimmed,
      })
      .select('*, user:users(roblox_username, roblox_avatar_url)')
      .single();

    if (err) {
      console.error('Comment insert error:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ comment }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Comment error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
