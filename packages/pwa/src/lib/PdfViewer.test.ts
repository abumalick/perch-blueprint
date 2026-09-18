import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PdfViewer from './PdfViewer.svelte';

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    fileView: null as Record<string, unknown> | null,
    viewError: null as string | null,
    closeViewer: vi.fn(),
    ...over,
  };
}

const pdfView = (over: Record<string, unknown> = {}) => ({
  path: '/p/report.pdf',
  text: '',
  mediaType: 'application/pdf',
  blobUrl: 'blob:fake-object-url',
  truncated: false,
  binary: false,
  ...over,
});

describe('PdfViewer', () => {
  it('renders the pdf in an iframe from blobUrl', () => {
    const { container } = render(PdfViewer, { props: { store: fakeStore({ fileView: pdfView() }) as never } });
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    const frame = container.querySelector('iframe.frame') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('blob:fake-object-url');
  });

  it('opens the pdf in a new tab via the Open button', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    render(PdfViewer, { props: { store: fakeStore({ fileView: pdfView() }) as never } });
    await fireEvent.click(screen.getByRole('button', { name: /open/i }));
    expect(open).toHaveBeenCalledWith('blob:fake-object-url', '_blank');
    vi.unstubAllGlobals();
  });

  it('shows a too-large message and no iframe when over the cap', () => {
    const { container } = render(PdfViewer, {
      props: { store: fakeStore({ fileView: pdfView({ blobUrl: '', truncated: true }) }) as never },
    });
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(container.querySelector('iframe.frame')).toBeNull();
  });

  it('shows a loading state while the bytes are in flight', () => {
    const { container } = render(PdfViewer, {
      props: { store: fakeStore({ fileView: pdfView({ blobUrl: '' }) }) as never },
    });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(container.querySelector('iframe.frame')).toBeNull();
  });

  it('shows an error state when viewError is set', () => {
    render(PdfViewer, { props: { store: fakeStore({ viewError: 'denied' }) as never } });
    expect(screen.getByText(/couldn't open this file/i)).toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('returns to the browser on Back', async () => {
    const store = fakeStore({ fileView: pdfView() });
    render(PdfViewer, { props: { store: store as never } });
    await fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(store.closeViewer).toHaveBeenCalled();
  });
});
