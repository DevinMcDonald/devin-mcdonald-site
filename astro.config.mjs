import { defineConfig } from 'astro/config';
import { remarkFigletHeadings } from './src/plugins/remark-figlet-headings.mjs';
import { remarkWikiLinks }      from './src/plugins/remark-wiki-links.mjs';
import { remarkYouTubeEmbeds }  from './src/plugins/remark-youtube-embeds.mjs';
import { remarkStripDataview }  from './src/plugins/remark-strip-dataview.mjs';

export default defineConfig({
  site: 'https://devin-mcdonald.com',
  markdown: {
    remarkPlugins: [
      remarkStripDataview,
      remarkYouTubeEmbeds,
      remarkWikiLinks,
      remarkFigletHeadings,   // must run last so headings aren't modified before other plugins see them
    ],
  },
});
