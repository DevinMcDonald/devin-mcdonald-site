import { visit } from 'unist-util-visit';

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/;

export function remarkYouTubeEmbeds() {
  return (tree) => {
    visit(tree, 'image', (node, index, parent) => {
      const match = node.url?.match(YT_RE);
      if (!match) return;

      const videoId = match[1];
      const title = node.alt || 'Video';

      parent.children[index] = {
        type: 'html',
        value: `<div class="yt-embed"><iframe src="https://www.youtube.com/embed/${videoId}" title="${title}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>\n`,
      };
    });
  };
}
