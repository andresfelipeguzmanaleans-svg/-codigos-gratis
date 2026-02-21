import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://codigos-gratis.com',
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
