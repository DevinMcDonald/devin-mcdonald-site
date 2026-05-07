import { defineCollection, z } from 'astro:content';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { remarkStripDataview } from '../plugins/remark-strip-dataview.mjs';
import { remarkYouTubeEmbeds }  from '../plugins/remark-youtube-embeds.mjs';
import { remarkWikiLinks }      from '../plugins/remark-wiki-links.mjs';
import { remarkFigletHeadings } from '../plugins/remark-figlet-headings.mjs';

const VAULT_PATH = process.env.VAULT_PATH ?? '/Users/devinmcdonald/Obsidian Vault/personal';

function makeProcessor(validIds: Set<string>) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkStripDataview)
    .use(remarkYouTubeEmbeds)
    .use(remarkWikiLinks, { validIds })
    .use(remarkFigletHeadings)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify);
}

function toId(filename: string): string {
  return filename
    .replace(/\.md$/, '')
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function obsidianFitnessLoader() {
  return {
    name: 'obsidian-fitness-loader',
    async load({ store, logger }: { store: any; logger: any }) {
      let files: string[];
      try {
        files = await readdir(VAULT_PATH);
      } catch {
        logger.warn(`Vault not found at ${VAULT_PATH} — fitness collection will be empty.`);
        return;
      }

      // First pass: collect valid IDs so wiki links can be validated
      const fitnessFiles: { file: string; id: string; data: any; content: string }[] = [];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const raw = await readFile(join(VAULT_PATH, file), 'utf-8');
        const { data, content } = matter(raw);
        if (data.section !== 'fitness') continue;
        fitnessFiles.push({ file, id: toId(file), data, content });
      }

      const validIds = new Set(fitnessFiles.map(f => f.id));
      const processor = makeProcessor(validIds);

      // Second pass: render with link validation
      let count = 0;
      for (const { file, id, data, content } of fitnessFiles) {
        const result = await processor.process(content);
        store.set({
          id,
          data: {
            title: data.title ?? file.replace(/\.md$/, ''),
            ...data,
          },
          body: content,
          rendered: { html: String(result) },
        });
        count++;
      }

      logger.info(`Loaded ${count} fitness note(s) from vault.`);
    },
  };
}

export const collections = {
  fitness: defineCollection({
    loader: obsidianFitnessLoader(),
    schema: z.object({
      title:       z.string().optional(),
      section:     z.string(),
      publish:     z.boolean().optional(),
      description: z.string().optional(),
      aliases:     z.union([z.string(), z.array(z.string())]).optional(),
      tags:        z.array(z.string()).optional(),
    }).passthrough(),
  }),
};
