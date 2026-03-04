import type { APIRoute } from 'astro';

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
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
    const sessionData = JSON.parse(Buffer.from(sessionCookie, 'base64').toString());

    if (sessionData.exp && sessionData.exp < Date.now()) {
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
