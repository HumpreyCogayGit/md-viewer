// Remove HTML comments (e.g. <!-- toc --> markers) from the preview. Other raw HTML is still shown as text.
export function remarkStripComments() {
  return (tree) => {
    const visit = (node) => {
      if (!node.children) return;
      node.children = node.children.filter(
        (child) => !(child.type === 'html' && /^\s*<!--[\s\S]*-->\s*$/.test(child.value)),
      );
      node.children.forEach(visit);
    };
    visit(tree);
  };
}
