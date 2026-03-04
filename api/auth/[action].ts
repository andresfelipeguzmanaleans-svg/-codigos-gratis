import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getSite(): string {
  return process.env.SITE || 'https://codigos-gratis.com';
}

async function handleLogin(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.ROBLOX_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'ROBLOX_CLIENT_ID not configured' });
  }

  const site = getSite();
  const redirectUri = `${site}/api/auth/callback`;

  // Save where the user came from so we can redirect back after login
  const returnTo = (req.query.return_to as string) || req.headers.referer || '/';

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

  const url = `https://apis.roblox.com/oauth/v1/authorize?${params.toString()}`;

  // Sanitize returnTo — only allow relative paths from our own site
  const safeReturn = returnTo.startsWith('/') ? returnTo : '/';

  res.setHeader('Set-Cookie', [
    `roblox_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `roblox_code_verifier=${codeVerifier}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `roblox_return_to=${encodeURIComponent(safeReturn)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  ]);

  res.redirect(302, url);
}

async function handleCallback(req: VercelRequest, res: VercelResponse) {
  const { code, state, error: oauthError } = req.query;

  const cookieHeader = req.headers.cookie || '';
  const returnTo = decodeURIComponent(parseCookie(cookieHeader, 'roblox_return_to') || '/');

  if (oauthError) {
    console.error('Roblox OAuth error:', oauthError);
    return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=denied`);
  }

  if (!code || !state) {
    return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=missing_params`);
  }

  const storedState = parseCookie(cookieHeader, 'roblox_oauth_state');
  const codeVerifier = parseCookie(cookieHeader, 'roblox_code_verifier');

  if (!storedState || storedState !== state) {
    return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=invalid_state`);
  }

  if (!codeVerifier) {
    return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=missing_verifier`);
  }

  try {
    const clientId = process.env.ROBLOX_CLIENT_ID!;
    const clientSecret = process.env.ROBLOX_CLIENT_SECRET!;
    const site = getSite();
    const redirectUri = `${site}/api/auth/callback`;

    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', tokenRes.status, errText);
      return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=token_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userInfoRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      console.error('User info fetch failed:', userInfoRes.status);
      return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=userinfo_failed`);
    }

    const userInfo = await userInfoRes.json();
    const robloxId = Number(userInfo.sub);
    const robloxUsername = userInfo.preferred_username || userInfo.name || `User${robloxId}`;
    const displayName = userInfo.nickname || userInfo.name || robloxUsername;

    let avatarUrl: string | null = null;
    try {
      const avatarRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png`,
      );
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json();
        avatarUrl = avatarData.data?.[0]?.imageUrl || null;
      }
    } catch {}

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
    );

    const { data: user, error: dbError } = await supabase
      .from('users')
      .upsert(
        {
          roblox_id: robloxId,
          roblox_username: robloxUsername,
          roblox_avatar_url: avatarUrl,
          display_name: displayName,
          last_login: new Date().toISOString(),
        },
        { onConflict: 'roblox_id' },
      )
      .select('id, roblox_id, roblox_username, roblox_avatar_url, display_name')
      .single();

    if (dbError) {
      console.error('Supabase upsert error:', dbError);
      return res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=db_error`);
    }

    const sessionPayload = JSON.stringify({
      userId: user.id,
      robloxId: user.roblox_id,
      username: user.roblox_username,
      avatar: user.roblox_avatar_url,
      displayName: user.display_name,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    const sessionToken = Buffer.from(sessionPayload).toString('base64');

    res.setHeader('Set-Cookie', [
      `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      `roblox_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `roblox_code_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `roblox_return_to=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    ]);

    res.redirect(302, returnTo);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect(302, `${returnTo}${returnTo.includes('?') ? '&' : '?'}auth_error=unknown`);
  }
}

async function handleLogout(req: VercelRequest, res: VercelResponse) {
  const returnTo = (req.query.return_to as string) || req.headers.referer || '/';
  const safeReturn = returnTo.startsWith('/') ? returnTo : '/';

  res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.redirect(302, safeReturn);
}

async function handleMe(req: VercelRequest, res: VercelResponse) {
  const cookieHeader = req.headers.cookie || '';
  const sessionCookie = parseCookie(cookieHeader, 'session');

  if (!sessionCookie) {
    return res.json({ user: null });
  }

  try {
    const sessionData = JSON.parse(Buffer.from(sessionCookie, 'base64').toString());

    if (sessionData.exp && sessionData.exp < Date.now()) {
      res.setHeader('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return res.json({ user: null });
    }

    return res.json({
      user: {
        id: sessionData.userId,
        robloxId: sessionData.robloxId,
        username: sessionData.username,
        avatar: sessionData.avatar,
        displayName: sessionData.displayName,
      },
    });
  } catch {
    return res.json({ user: null });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string;

  switch (action) {
    case 'login':
      return handleLogin(req, res);
    case 'callback':
      return handleCallback(req, res);
    case 'logout':
      return handleLogout(req, res);
    case 'me':
      return handleMe(req, res);
    default:
      return res.status(404).json({ error: 'Not found' });
  }
}
