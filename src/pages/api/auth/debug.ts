import type { APIRoute } from 'astro';

function runtimeEnv(key: string): string | undefined {
  const g = globalThis as Record<string, any>;
  return g['process']?.['env']?.[key];
}

export const GET: APIRoute = async () => {
  const keys = ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const result: Record<string, string> = {};

  for (const key of keys) {
    const runtime = runtimeEnv(key);
    result[`${key}_runtime`] = runtime ? `SET (${runtime.substring(0, 4)}...)` : 'MISSING';
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
};
