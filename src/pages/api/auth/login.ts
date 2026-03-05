import type { APIRoute } from 'astro';
import crypto from 'crypto';

export const GET: APIRoute = async ({ request }) => {
  const clientId = process.env.ROBLOX_CLIENT_ID || import.meta.env.ROBLOX_CLIENT_ID;
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'ROBLOX_CLIENT_ID not configured' }), { status: 500 });
  }

  const site = import.meta.env.SITE || 'https://codigos-gratis.com';
  const redirectUri = `${site}/api/auth/callback/`;

  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || request.headers.get('referer') || '/';
  const safeReturn = returnTo.startsWith('/') ? returnTo : '/';

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();

  const digest = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = digest
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`;

  const headers = new Headers({ Location: authUrl });
  headers.append('Set-Cookie', `roblox_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  headers.append('Set-Cookie', `roblox_code_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  headers.append('Set-Cookie', `roblox_return_to=${encodeURIComponent(safeReturn)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  return new Response(null, { status: 302, headers });
};
