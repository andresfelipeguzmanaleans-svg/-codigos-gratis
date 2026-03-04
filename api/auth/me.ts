import type { VercelRequest, VercelResponse } from '@vercel/node';

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
