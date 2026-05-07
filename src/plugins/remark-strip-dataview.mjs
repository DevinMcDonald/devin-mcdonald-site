import { visit } from 'unist-util-visit';

export function remarkStripDataview() {
  return (tree) => {
    // collect then remove to avoid index shifting during traversal
    const targets = [];
    visit(tree, 'code', (node, index, parent) => {
      if (node.lang === 'dataview') targets.push({ parent, index });
    });
    for (const { parent, index } of targets.reverse()) {
      parent.children.splice(index, 1);
    }
  };
}
