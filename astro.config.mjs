import { defineConfig } from 'astro/config';
import { remarkFigletHeadings } from './src/plugins/remark-figlet-headings.mjs';
import { remarkWikiLinks }      from './src/plugins/remark-wiki-links.mjs';
import { remarkYouTubeEmbeds }  from './src/plugins/remark-youtube-embeds.mjs';

export default defineConfig({
  site: 'https://devin-mcdonald.com',
  vite: {
    build: {
      rollupOptions: {
        // catcat.js is a build artifact placed in public/wasm/ at deploy time
        external: ['/wasm/catcat.js'],
      },
    },
  },
  markdown: {
    remarkPlugins: [
      remarkYouTubeEmbeds,
      remarkWikiLinks,
      remarkFigletHeadings,   // must run last so headings aren't modified before other plugins see them
    ],
  },
});
