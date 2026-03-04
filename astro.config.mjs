import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { readFileSync } from 'node:fs';

const redirectPaths = JSON.parse(readFileSync('./data/redirects.json', 'utf-8'));
const redirects = Object.fromEntries(
  redirectPaths.map((path) => [path, { destination: '/', status: 301 }])
);

export default defineConfig({
  site: 'https://codigos-gratis.com',
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'always',
  integrations: [
    sitemap({
      serialize(item) {
        const p = item.url.replace('https://codigos-gratis.com', '');

        // Fisch hub & values → high priority, frequent updates
        if (p === '/games/fisch/' || p === '/games/fisch/values/') {
          item.priority = 0.9;
          item.changefreq = p.includes('values') ? 'daily' : 'weekly';
        }
        // Fish index, calculator → high priority
        else if (p === '/games/fisch/fish/' || p === '/games/fisch/calculator/') {
          item.priority = 0.8;
          item.changefreq = 'weekly';
        }
        // Mutations, rods, locations → medium priority
        else if (
          p === '/games/fisch/mutations/' ||
          p === '/games/fisch/rods/' ||
          p === '/games/fisch/locations/'
        ) {
          item.priority = 0.7;
          item.changefreq = 'monthly';
        }
        // Individual fish pages → standard priority
        else if (p.startsWith('/games/fisch/fish/') && p !== '/games/fisch/fish/') {
          item.priority = 0.6;
          item.changefreq = 'monthly';
        }
        // New game hubs → high priority
        else if (/^\/games\/(adopt-me|blox-fruits|mm2|grow-a-garden)\/$/.test(p)) {
          item.priority = 0.9;
          item.changefreq = 'weekly';
        }
        // New game values → high priority, frequent updates
        else if (/^\/games\/(adopt-me|blox-fruits|mm2|grow-a-garden)\/values\/$/.test(p)) {
          item.priority = 0.9;
          item.changefreq = 'daily';
        }
        // New game calculators → high priority
        else if (/^\/games\/(adopt-me|blox-fruits|mm2|grow-a-garden)\/calculator\/$/.test(p)) {
          item.priority = 0.8;
          item.changefreq = 'weekly';
        }
        // Homepage
        else if (p === '/') {
          item.priority = 1.0;
          item.changefreq = 'daily';
        }
        // Codes pages (existing site)
        else if (p.startsWith('/codigos-')) {
          item.priority = 0.7;
          item.changefreq = 'weekly';
        }

        return item;
      },
    }),
    react(),
  ],
  redirects: {
    ...redirects,
    '/sitemap.xml': { destination: '/sitemap-index.xml', status: 301 },
  },
});
