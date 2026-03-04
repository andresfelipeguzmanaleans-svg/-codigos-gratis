import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return_to') || request.headers.get('referer') || '/';
  const safeReturn = returnTo.startsWith('/') ? returnTo : '/';

  const headers = new Headers({ Location: safeReturn });
  headers.append('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  return new Response(null, { status: 302, headers });
};
