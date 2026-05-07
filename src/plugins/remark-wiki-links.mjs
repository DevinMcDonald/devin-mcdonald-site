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

export function remarkWikiLinks(options = {}) {
  const { basePath = '/fitness', validIds = null } = options;

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

        const target = match[1].trim();
        const display = match[2]?.trim() ?? target;
        const slug = toSlug(target);

        const known = validIds === null || validIds.has(slug);
        parts.push(known
          ? { type: 'link', url: `${basePath}/${slug}`, title: null, children: [{ type: 'text', value: display }] }
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
