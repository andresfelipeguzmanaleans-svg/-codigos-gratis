import { defineMiddleware } from 'astro:middleware';

// ── In-memory rate limiter (per serverless instance) ──
// Each Vercel function instance has its own map. This provides per-instance
// protection — not perfect, but stops most abuse without external infrastructure.

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Clean up stale entries every 60s to prevent memory leaks
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  cleanup();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count++;
  return bucket.count > maxRequests;
}

function getClientIP(request: Request): string {
  // Vercel sets these headers
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

// Rate limit configs per route pattern
interface RateLimitConfig {
  pattern: RegExp;
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: RateLimitConfig[] = [
  // Public Roblox proxy endpoints — strict limits (abused as amplifiers)
  { pattern: /^\/api\/roblox-/, maxRequests: 10, windowMs: 60_000 },     // 10/min
  // Unauthenticated view endpoint
  { pattern: /^\/api\/listings\/view/, maxRequests: 20, windowMs: 60_000 }, // 20/min
  // Auth endpoints
  { pattern: /^\/api\/auth\/login/, maxRequests: 5, windowMs: 60_000 },   // 5/min
  { pattern: /^\/api\/auth\/callback/, maxRequests: 5, windowMs: 60_000 },
  // Write endpoints (authenticated, but still limit)
  { pattern: /^\/api\/listings\/create/, maxRequests: 10, windowMs: 60_000 },
  { pattern: /^\/api\/listings\/comments/, maxRequests: 20, windowMs: 60_000 },
  { pattern: /^\/api\/listings\/delete/, maxRequests: 10, windowMs: 60_000 },
  { pattern: /^\/api\/offers\//, maxRequests: 15, windowMs: 60_000 },
  // Catch-all for any /api/ route
  { pattern: /^\/api\//, maxRequests: 60, windowMs: 60_000 },            // 60/min
];

export const onRequest = defineMiddleware(async ({ request }, next) => {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Only apply rate limiting to API routes
  if (!pathname.startsWith('/api/')) {
    return next();
  }

  const ip = getClientIP(request);

  // Find the first matching rate limit config
  for (const config of RATE_LIMITS) {
    if (config.pattern.test(pathname)) {
      const key = `${ip}:${config.pattern.source}`;
      if (isRateLimited(key, config.maxRequests, config.windowMs)) {
        return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
          },
        });
      }
      break;
    }
  }

  return next();
});
