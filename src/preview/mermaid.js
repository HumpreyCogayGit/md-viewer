// Mermaid is loaded only when a document contains a ```mermaid block. Renders are serialized because Mermaid
// keeps global configuration (theme), and rendering two themes concurrently would mix them.

let mermaidPromise;
let queue = Promise.resolve();
let counter = 0;

export function loadMermaid() {
  mermaidPromise ||= import('mermaid').then((module) => module.default || module);
  return mermaidPromise;
}

export function renderMermaidSvg(code, theme = 'default') {
  const task = queue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      theme,
      // Untrusted diagram text: no click handlers, no HTML in labels, sanitized output.
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    counter += 1;
    const { svg } = await mermaid.render(`speculo-mermaid-${counter}`, String(code).trim());
    return svg;
  });
  queue = task.catch(() => {});
  return task;
}

export async function parseMermaid(code) {
  const mermaid = await loadMermaid();
  return mermaid.parse(String(code));
}
