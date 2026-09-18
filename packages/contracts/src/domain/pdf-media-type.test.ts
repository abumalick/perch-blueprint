import { describe, it, expect } from 'vitest';
import { pdfMediaType } from './pdf-media-type';

describe('pdfMediaType', () => {
  it('maps the pdf extension (case-insensitive)', () => {
    expect(pdfMediaType('/a/b.pdf')).toBe('application/pdf');
    expect(pdfMediaType('report.PDF')).toBe('application/pdf');
  });

  it('returns empty for non-pdf, extensionless, and dotfile paths', () => {
    expect(pdfMediaType('/a/b.txt')).toBe('');
    expect(pdfMediaType('/a/b.png')).toBe('');
    expect(pdfMediaType('/a/README')).toBe('');
    expect(pdfMediaType('/a/.pdfrc')).toBe('');
  });
});
