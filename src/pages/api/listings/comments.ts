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

  const { listingId, body: commentBody } = body;

  if (!listingId || !commentBody || typeof commentBody !== 'string') {
    return new Response(JSON.stringify({ error: 'listingId and body required' }), {
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
