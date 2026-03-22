import type { APIRoute } from 'astro';
import { parseCookie, verifySessionToken } from '../../../lib/auth';

// Backwards-compatible: also accept old unsigned base64 tokens during migration
function verifyLegacyToken(token: string) {
  if (token.includes('.')) return null;
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const sessionCookie = parseCookie(cookieHeader, 'session');

  if (!sessionCookie) {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const sessionData = verifySessionToken(sessionCookie) || verifyLegacyToken(sessionCookie);

    if (!sessionData) {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return new Response(JSON.stringify({ user: null }), { headers });
    }

    return new Response(
      JSON.stringify({
        user: {
          id: sessionData.userId,
          robloxId: sessionData.robloxId,
          username: sessionData.username,
          avatar: sessionData.avatar,
          displayName: sessionData.displayName,
        },
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch {
    return new Response(JSON.stringify({ user: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
