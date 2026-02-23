import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';

const redirectPaths = JSON.parse(readFileSync('./data/redirects.json', 'utf-8'));
const redirects = Object.fromEntries(
  redirectPaths.map((path) => [path, { destination: '/', status: 301 }])
);

export default defineConfig({
  site: 'https://www.codigos-gratis.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
  redirects,
});
