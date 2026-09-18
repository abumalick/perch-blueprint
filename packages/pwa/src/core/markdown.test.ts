import { describe, it, expect } from 'vitest';
import { isMarkdownPath, renderMarkdown } from './markdown';

describe('isMarkdownPath', () => {
  it('accepts .md and .markdown, whatever the case', () => {
    expect(isMarkdownPath('/p/README.md')).toBe(true);
    expect(isMarkdownPath('/p/notes.MD')).toBe(true);
    expect(isMarkdownPath('/p/notes.markdown')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isMarkdownPath('/p/a.txt')).toBe(false);
    expect(isMarkdownPath('/p/mdfile')).toBe(false);
    expect(isMarkdownPath('/p/a.md.bak')).toBe(false);
  });
});

describe('renderMarkdown', () => {
  it('renders headings, emphasis and links', () => {
    const html = renderMarkdown('# Title\n\nsome **bold** and [a link](https://x.dev)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://x.dev"');
  });

  it('renders GFM tables and task lists', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('type="checkbox"');
  });

  it('renders fenced code without executing it', () => {
    const html = renderMarkdown('```js\nconst x = 1 < 2;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('const x = 1 &lt; 2;');
  });

  // Browsable roots hold third-party markdown (dependency READMEs, cloned repos), and the PWA
  // holds the machine bearer tokens — so raw HTML in a document must not keep its teeth.
  it('strips event handlers and scripts from embedded HTML', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });

  it('strips javascript: links', () => {
    expect(renderMarkdown('[click](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('keeps benign embedded HTML', () => {
    expect(renderMarkdown('<kbd>Ctrl</kbd> and <br /> stay')).toContain('<kbd>Ctrl</kbd>');
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
