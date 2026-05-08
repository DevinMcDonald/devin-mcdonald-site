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
import { remarkDataview }      from '../plugins/remark-dataview.mjs';
import { remarkYouTubeEmbeds }  from '../plugins/remark-youtube-embeds.mjs';
import { remarkWikiLinks }      from '../plugins/remark-wiki-links.mjs';
import { remarkFigletHeadings } from '../plugins/remark-figlet-headings.mjs';

const VAULT_PATH = process.env.VAULT_PATH ?? '/Users/devinmcdonald/Obsidian Vault/personal';
const SITE_MOC_TITLE = 'Site MOC';

// ── helpers ───────────────────────────────────────────────────────────────────

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseWikiLinks(content: string): string[] {
  const re = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) titles.push(m[1].trim());
  return titles;
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  if (typeof raw === 'string') return [raw];
  return [];
}

function isMoc(data: Record<string, any>): boolean {
  const tags: unknown[] = Array.isArray(data.tags) ? data.tags
    : typeof data.tags === 'string' ? [data.tags] : [];
  return tags.some(t => typeof t === 'string' && t.toLowerCase() === 'moc');
}

// ── tree types ────────────────────────────────────────────────────────────────

interface FileEntry {
  title: string;
  data:  Record<string, any>;
  content: string;
}

interface SiteNode {
  title:     string;
  slug:      string;
  urlPath:   string[];
  urlString: string;
  parentUrl: string;
  isMoc:     boolean;
  data:      Record<string, any>;
  content:   string;
  children:  SiteNode[];
}

// ── tree builder ──────────────────────────────────────────────────────────────

function buildNode(
  filesMap: Map<string, FileEntry>,
  title:    string,
  parentPath: string[],
  visited:  Set<string>,
  urlMap:   Map<string, string>,
): SiteNode | null {
  if (visited.has(title)) return null;
  visited.add(title);

  const entry = filesMap.get(title);
  if (!entry || entry.data.publish !== true) return null;

  const slug      = typeof entry.data.slug === 'string' ? entry.data.slug : toSlug(title);
  const urlPath   = [...parentPath, slug];
  const urlString = '/' + urlPath.join('/');
  const parentUrl = parentPath.length > 0 ? '/' + parentPath.join('/') : '/';
  const mocNode   = isMoc(entry.data);

  // Register this note (and its aliases) in the URL map for wiki link resolution
  urlMap.set(title, urlString);
  const aliases: unknown[] = Array.isArray(entry.data.aliases) ? entry.data.aliases
    : typeof entry.data.aliases === 'string' ? [entry.data.aliases] : [];
  for (const alias of aliases) {
    if (typeof alias === 'string') urlMap.set(alias, urlString);
  }

  // Only recurse into children when this node is a MOC
  const children: SiteNode[] = [];
  if (mocNode) {
    for (const childTitle of parseWikiLinks(entry.content)) {
      const child = buildNode(filesMap, childTitle, urlPath, visited, urlMap);
      if (child) children.push(child);
    }
  }

  return {
    title: typeof entry.data.title === 'string' ? entry.data.title : title,
    slug, urlPath, urlString, parentUrl,
    isMoc: mocNode,
    data: entry.data,
    content: entry.content,
    children,
  };
}

// Flatten tree into list, skipping the Site MOC root itself
function flattenTree(nodes: SiteNode[]): SiteNode[] {
  const result: SiteNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) result.push(...flattenTree(node.children));
  }
  return result;
}

// ── processor factory ─────────────────────────────────────────────────────────

function makeProcessor(urlMap: Map<string, string>, vaultData: any[]) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDataview, { vaultData })
    .use(remarkYouTubeEmbeds)
    .use(remarkWikiLinks, { urlMap })
    .use(remarkFigletHeadings)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeStringify);
}

// ── loader ────────────────────────────────────────────────────────────────────

function obsidianSiteLoader() {
  return {
    name: 'obsidian-site-loader',
    async load({ store, logger }: { store: any; logger: any }) {
      // Read all markdown files from vault
      let files: string[];
      try {
        files = await readdir(VAULT_PATH);
      } catch {
        logger.warn(`Vault not found at ${VAULT_PATH} — site collection will be empty.`);
        return;
      }

      // Build title → entry map
      const filesMap = new Map<string, FileEntry>();
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const title = file.replace(/\.md$/, '');
        const raw = await readFile(join(VAULT_PATH, file), 'utf-8');
        const { data, content } = matter(raw);
        filesMap.set(title, { title, data, content });
      }

      if (!filesMap.has(SITE_MOC_TITLE)) {
        logger.warn(`"${SITE_MOC_TITLE}.md" not found in vault — site collection will be empty.`);
        return;
      }

      // Pass 1: traverse MOC graph from Site MOC, building URL map and tree
      const urlMap  = new Map<string, string>();
      const visited = new Set<string>();
      visited.add(SITE_MOC_TITLE); // exclude Site MOC itself (it's the homepage)

      const siteMoc = filesMap.get(SITE_MOC_TITLE)!;
      const topLevelNodes: SiteNode[] = [];
      for (const childTitle of parseWikiLinks(siteMoc.content)) {
        const node = buildNode(filesMap, childTitle, [], visited, urlMap);
        if (node) topLevelNodes.push(node);
      }

      const allNodes = flattenTree(topLevelNodes);
      logger.info(`Found ${allNodes.length} publishable note(s).`);

      // Build vaultData from ALL vault files for Dataview queries (not just published)
      const vaultData = Array.from(filesMap.entries()).map(([title, entry]) => ({
        title,
        data:   entry.data,
        tags:   normalizeTags(entry.data.tags),
        url:    urlMap.get(title) ?? null,
        folder: null,
      }));

      // Pass 2: render each node with full URL map and store
      const processor = makeProcessor(urlMap, vaultData);

      for (const node of allNodes) {
        const html = String(await processor.process(node.content));

        const childItems = node.children.map(c => ({
          id:    c.slug,
          title: c.title,
          href:  c.urlString,
        }));

        store.set({
          id: node.urlPath.join('/'),
          data: {
            title:     node.title,
            urlPath:   node.urlPath,
            urlString: node.urlString,
            parentUrl: node.parentUrl,
            isMoc:     node.isMoc,
            children:  childItems,
            publish:   true,
            ...node.data,
          },
          body: node.content,
          rendered: { html },
        });
      }
    },
  };
}

// ── collection ────────────────────────────────────────────────────────────────

export const collections = {
  site: defineCollection({
    loader: obsidianSiteLoader(),
    schema: z.object({
      title:     z.string(),
      urlPath:   z.array(z.string()),
      urlString: z.string(),
      parentUrl: z.string(),
      isMoc:     z.boolean(),
      children:  z.array(z.object({
        id:    z.string(),
        title: z.string(),
        href:  z.string(),
      })),
      publish:     z.boolean().optional(),
      description: z.string().optional(),
      tags:        z.union([z.string(), z.array(z.string())]).optional(),
      aliases:     z.union([z.string(), z.array(z.string())]).optional(),
      slug:        z.string().optional(),
    }).passthrough(),
  }),
};
