export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.SUPABASE_SECRET_KEY,
);

export const GET: APIRoute = async ({ request, redirect, cookies }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    console.error('Roblox OAuth error:', error, url.searchParams.get('error_description'));
    return redirect('/games/fisch/trading/?auth_error=denied');
  }

  if (!code || !state) {
    return redirect('/games/fisch/trading/?auth_error=missing_params');
  }

  // Verify state
  const cookieHeader = request.headers.get('cookie') || '';
  const storedState = parseCookie(cookieHeader, 'roblox_oauth_state');
  const codeVerifier = parseCookie(cookieHeader, 'roblox_code_verifier');

  if (!storedState || storedState !== state) {
    return redirect('/games/fisch/trading/?auth_error=invalid_state');
  }

  if (!codeVerifier) {
    return redirect('/games/fisch/trading/?auth_error=missing_verifier');
  }

  try {
    // Exchange code for token
    const clientId = import.meta.env.ROBLOX_CLIENT_ID;
    const clientSecret = import.meta.env.ROBLOX_CLIENT_SECRET;
    const redirectUri = `${import.meta.env.SITE || 'https://codigos-gratis.com'}/api/auth/callback/`;

    const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
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
      return redirect('/games/fisch/trading/?auth_error=token_failed');
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Get user info from Roblox
    const userInfoRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userInfoRes.ok) {
      console.error('User info fetch failed:', userInfoRes.status);
      return redirect('/games/fisch/trading/?auth_error=userinfo_failed');
    }

    const userInfo = await userInfoRes.json();
    const robloxId = Number(userInfo.sub);
    const robloxUsername = userInfo.preferred_username || userInfo.name || `User${robloxId}`;
    const displayName = userInfo.nickname || userInfo.name || robloxUsername;

    // Get avatar URL from Roblox API
    let avatarUrl: string | null = null;
    try {
      const avatarRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png`,
      );
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json();
        avatarUrl = avatarData.data?.[0]?.imageUrl || null;
      }
    } catch {
      // avatar fetch is non-critical
    }

    // Upsert user in Supabase
    const { data: user, error: dbError } = await supabaseAdmin
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
      return redirect('/games/fisch/trading/?auth_error=db_error');
    }

    // Create a simple session token (user ID signed with secret)
    const sessionPayload = JSON.stringify({
      userId: user.id,
      robloxId: user.roblox_id,
      username: user.roblox_username,
      avatar: user.roblox_avatar_url,
      displayName: user.display_name,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    const sessionToken = btoa(sessionPayload);

    // Set session cookie and clear OAuth cookies
    const secureCookie = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800'; // 7 days
    const clearCookie = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/games/fisch/trading/',
        'Set-Cookie': [
          `session=${sessionToken}; ${secureCookie}`,
          `roblox_oauth_state=; ${clearCookie}`,
          `roblox_code_verifier=; ${clearCookie}`,
        ].join(', '),
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return redirect('/games/fisch/trading/?auth_error=unknown');
  }
};

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
