import type { APIRoute } from 'astro';

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function redirectTo(url: string, cookies?: string[]): Response {
  const headers = new Headers({ Location: url });
  if (cookies) {
    for (const c of cookies) headers.append('Set-Cookie', c);
  }
  return new Response(null, { status: 302, headers });
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const cookieHeader = request.headers.get('cookie') || '';
  const returnTo = decodeURIComponent(parseCookie(cookieHeader, 'roblox_return_to') || '/');
  const sep = returnTo.includes('?') ? '&' : '?';

  if (oauthError) {
    console.error('Roblox OAuth error:', oauthError);
    return redirectTo(`${returnTo}${sep}auth_error=denied`);
  }

  if (!code || !state) {
    return redirectTo(`${returnTo}${sep}auth_error=missing_params`);
  }

  const storedState = parseCookie(cookieHeader, 'roblox_oauth_state');
  const codeVerifier = parseCookie(cookieHeader, 'roblox_code_verifier');

  if (!storedState || storedState !== state) {
    return redirectTo(`${returnTo}${sep}auth_error=invalid_state`);
  }

  if (!codeVerifier) {
    return redirectTo(`${returnTo}${sep}auth_error=missing_verifier`);
  }

  try {
    const clientId = process.env.ROBLOX_CLIENT_ID || import.meta.env.ROBLOX_CLIENT_ID;
    const clientSecret = process.env.ROBLOX_CLIENT_SECRET || import.meta.env.ROBLOX_CLIENT_SECRET;
    const site = import.meta.env.SITE || 'https://codigos-gratis.com';
    const redirectUri = `${site}/api/auth/callback/`;

    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Token exchange failed:', tokenRes.status, errText);
      return redirectTo(`${returnTo}${sep}auth_error=token_failed`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const userInfoRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      console.error('User info fetch failed:', userInfoRes.status);
      return redirectTo(`${returnTo}${sep}auth_error=userinfo_failed`);
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
      process.env.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY || import.meta.env.SUPABASE_SECRET_KEY,
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
      return redirectTo(`${returnTo}${sep}auth_error=db_error`);
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

    return redirectTo(returnTo, [
      `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      `roblox_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `roblox_code_verifier=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
      `roblox_return_to=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    ]);
  } catch (err: any) {
    console.error('OAuth callback error:', err);
    const msg = encodeURIComponent(err?.message || 'unknown');
    return redirectTo(`${returnTo}${sep}auth_error=${msg}`);
  }
};
