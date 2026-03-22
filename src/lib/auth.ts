import crypto from 'crypto';

// Runtime env access — opaque to Vite/esbuild so it won't be replaced at build time
export function runtimeEnv(key: string): string | undefined {
  const g = globalThis as Record<string, any>;
  return g['process']?.['env']?.[key];
}

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ── Signed session tokens (HMAC-SHA256) ──

function getSessionSecret(): string {
  const secret = runtimeEnv('SESSION_SECRET') || import.meta.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not configured');
  return secret;
}

function hmacSign(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function createSessionToken(data: {
  userId: string;
  robloxId: number;
  username: string;
  avatar: string | null;
  displayName: string;
}): string {
  const payload = JSON.stringify({
    ...data,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = hmacSign(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): {
  userId: string;
  robloxId: number;
  username: string;
  avatar: string | null;
  displayName: string;
  exp: number;
} | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  // Verify signature
  const expectedSig = hmacSign(encoded);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Backwards-compatible: also accept old unsigned base64 tokens during migration
// Remove this after all old sessions expire (7 days after deploy)
function verifyLegacyToken(token: string): ReturnType<typeof verifySessionToken> {
  if (token.includes('.')) return null; // Not a legacy token
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    if (!payload.userId || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface SessionData {
  userId: string;
  robloxId: number;
  username: string;
}

export function getSession(request: Request): SessionData | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const token = parseCookie(cookieHeader, 'session');
  if (!token) return null;

  // Try new signed tokens first, then fall back to legacy
  const payload = verifySessionToken(token) || verifyLegacyToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    robloxId: payload.robloxId,
    username: payload.username,
  };
}

// ── UUID validation ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
