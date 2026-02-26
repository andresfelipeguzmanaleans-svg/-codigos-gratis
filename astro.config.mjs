import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import { readFileSync } from 'node:fs';

const redirectPaths = JSON.parse(readFileSync('./data/redirects.json', 'utf-8'));
const redirects = Object.fromEntries(
  redirectPaths.map((path) => [path, { destination: '/', status: 301 }])
);

export default defineConfig({
  site: 'https://codigos-gratis.com',
  output: 'static',
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
  redirects,
});
