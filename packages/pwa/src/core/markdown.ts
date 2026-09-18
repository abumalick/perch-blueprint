import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Own instance so the viewer's options can't be changed by (or leak into) any other use.
const marked = new Marked({ gfm: true, breaks: false, async: false });

// Markdown → HTML for the file viewer. The result is injected with {@html}, and `marked` passes
// raw HTML in a document straight through, so it is sanitized: the browsable roots hold
// third-party markdown (dependency READMEs, cloned repos), and the PWA holds the machine bearer
// tokens that grant terminal input on every agent.
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string);
}
