import figlet from 'figlet';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';

// h1 → Big (6 lines), h2 → Small (4 lines), h3 → Mini (3 lines)
const FONTS = { 1: 'Big', 2: 'Small', 3: 'Mini' };

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function remarkFigletHeadings() {
  return (tree) => {
    visit(tree, 'heading', (node, index, parent) => {
      const level = node.depth;
      const text = toString(node);
      const font = FONTS[Math.min(level, 3)];
      const cls = `figlet-h${Math.min(level, 4)}`;

      if (level >= 4) {
        parent.children[index] = {
          type: 'html',
          value: `<p class="figlet-h4" aria-label="${text}">· ${esc(text)}</p>\n`,
        };
        return;
      }

      try {
        const raw = figlet.textSync(text.toUpperCase(), { font });
        const trimmed = raw.trimEnd();
        parent.children[index] = {
          type: 'html',
          value: `<pre class="figlet-heading ${cls}" aria-label="${text}">${esc(trimmed)}</pre>\n`,
        };
      } catch {
        // leave heading unchanged on figlet error
      }
    });
  };
}
