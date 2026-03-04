export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ redirect }) => {
  const clientId = import.meta.env.ROBLOX_CLIENT_ID;
  const redirectUri = `${import.meta.env.SITE || 'https://codigos-gratis.com'}/api/auth/callback/`;

  // Generate a random state for CSRF protection
  const state = crypto.randomUUID();

  // PKCE: generate code_verifier and code_challenge
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
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

  const url = `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`;

  // Store state + code_verifier in cookies (short-lived, httpOnly)
  const cookieOpts = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': [
        `roblox_oauth_state=${state}; ${cookieOpts}`,
        `roblox_code_verifier=${codeVerifier}; ${cookieOpts}`,
      ].join(', '),
    },
  });
};
