import type { APIRoute } from 'astro';

function runtimeEnv(key: string): string | undefined {
  const g = globalThis as Record<string, any>;
  return g['process']?.['env']?.[key];
}

export const POST: APIRoute = async ({ request }) => {
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
  if (!listingId) {
    return new Response(JSON.stringify({ error: 'listingId required' }), {
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

    const { data: current } = await supabase
      .from('listings')
      .select('views_count')
      .eq('id', listingId)
      .single();

    if (current) {
      await supabase
        .from('listings')
        .update({ views_count: (current.views_count || 0) + 1 })
        .eq('id', listingId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('View increment error:', err);
    return new Response(JSON.stringify({ error: err?.message || 'Server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
