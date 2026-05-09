import { visit } from 'unist-util-visit';

const WIKI_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

export function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// urlMap: Map<noteTitle, urlString>  e.g. "Push Split" -> "/personal/fitness-overview/push-split"
export function remarkWikiLinks(options = {}) {
  const { urlMap = new Map() } = options;

  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!node.value.includes('[[')) return;

      const parts = [];
      let last = 0;
      WIKI_RE.lastIndex = 0;

      let match;
      while ((match = WIKI_RE.exec(node.value)) !== null) {
        if (match.index > last) {
          parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        }

        const raw     = match[1].trim();
        const hashIdx = raw.indexOf('#');
        const noteName = hashIdx !== -1 ? raw.slice(0, hashIdx).trim() : raw;
        const fragment  = hashIdx !== -1 ? raw.slice(hashIdx + 1).trim() : null;
        const display   = match[2]?.trim() ?? raw;
        const baseUrl   = urlMap.get(noteName);
        const url       = baseUrl ? (fragment ? `${baseUrl}#${toSlug(fragment)}` : baseUrl) : null;

        parts.push(url
          ? { type: 'link', url, title: null, children: [{ type: 'text', value: display }] }
          : { type: 'text', value: display }
        );

        last = match.index + match[0].length;
      }

      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(last) });
      }

      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
