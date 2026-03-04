import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.ROBLOX_CLIENT_ID;
  const site = process.env.SITE || 'https://codigos-gratis.com';
  const redirectUri = `${site}/api/auth/callback`;

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();

  const digest = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = digest
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const url = `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`;

  res.setHeader('Set-Cookie', [
    `roblox_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `roblox_code_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ]);

  res.redirect(302, url);
}
