/**
 * Tests for XdrExportModal.jsx (issue #1143)
 *
 * Covers:
 *  - correct XDR string output for a known transaction envelope
 *  - correct network-passphrase / Stellar Lab URL selection for
 *    testnet vs mainnet (via generateStellarLabUrl in xdrExport.js)
 *  - copy, download, and open-in-lab interactions
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { XdrExportModal } from '../src/components/XdrExportModal';
import { generateStellarLabUrl } from '../src/utils/xdrExport';

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderModal(props = {}) {
  const defaults = {
    open: true,
    onClose: vi.fn(),
    xdr: 'AAAAAQAAAA==',
    isSigned: true,
    isTestnet: false,
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <XdrExportModal {...defaults} {...props} />
    </I18nextProvider>
  );
}

// A realistic-looking (but synthetic) XDR envelope string
const SAMPLE_XDR =
  'AAAAAgAAAABGp36S7FEOo5c6iWQrM/XBxRf+D3HsHQTt2MkT7N5BIAAAAGQAHgLrAAAAGQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAAAAAEanfpLsUQ6jlzqJZCsz9cHFF/4PcewdBO3YyRPs3kEgAAAAAAAAAACdBg8JcWuC//qxAaJlhBiZoS5F0LfHMOcGLuNqm9BcAAAAAAAA=';

// ── generateStellarLabUrl unit tests ─────────────────────────────────────────
describe('generateStellarLabUrl (xdrExport.js)', () => {
  it('uses network=testnet when isTestnet=true', () => {
    const url = generateStellarLabUrl(SAMPLE_XDR, true);
    expect(url).toContain('network=testnet');
    expect(url).not.toContain('network=public');
  });

  it('uses network=public when isTestnet=false', () => {
    const url = generateStellarLabUrl(SAMPLE_XDR, false);
    expect(url).toContain('network=public');
    expect(url).not.toContain('network=testnet');
  });

  it('points to the Stellar Laboratory domain', () => {
    const url = generateStellarLabUrl(SAMPLE_XDR, false);
    expect(url).toContain('laboratory.stellar.org');
  });

  it('includes the XDR as a query parameter', () => {
    const url = generateStellarLabUrl(SAMPLE_XDR, false);
    expect(url).toContain(encodeURIComponent(SAMPLE_XDR));
  });

  it('never mixes testnet/public when called repeatedly', () => {
    const testnetUrl = generateStellarLabUrl(SAMPLE_XDR, true);
    const mainnetUrl = generateStellarLabUrl(SAMPLE_XDR, false);
    expect(testnetUrl).not.toBe(mainnetUrl);
    expect(testnetUrl).toContain('network=testnet');
    expect(mainnetUrl).toContain('network=public');
  });
});

// ── XdrExportModal component tests ───────────────────────────────────────────
describe('XdrExportModal (issue #1143)', () => {
  // Stub window.open so "Open in Lab" doesn't try to open a real tab
  let openSpy;
  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  });
  afterEach(() => {
    openSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders nothing when xdr is falsy', () => {
    const { container } = renderModal({ xdr: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the modal dialog when open=true and xdr is provided', () => {
    renderModal({ xdr: SAMPLE_XDR });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    renderModal({ xdr: SAMPLE_XDR, open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // ── XDR display ────────────────────────────────────────────────────────────
  it('shows the XDR string in the textarea', () => {
    renderModal({ xdr: SAMPLE_XDR });
    const textarea = screen.getByRole('textbox');
    // The displayed value may be line-wrapped (every 80 chars) but must
    // contain the content of the original XDR.
    expect(textarea.value.replace(/\n/g, '')).toBe(SAMPLE_XDR);
  });

  it('labels the textarea with the envelope label', () => {
    renderModal({ xdr: SAMPLE_XDR });
    expect(screen.getByLabelText(/XDR/i)).toBeInTheDocument();
  });

  // ── Signed / unsigned status ───────────────────────────────────────────────
  it('shows "Signed" status when isSigned=true', () => {
    renderModal({ xdr: SAMPLE_XDR, isSigned: true });
    expect(screen.getByText(/signed/i)).toBeInTheDocument();
  });

  it('shows "Unsigned" status when isSigned=false', () => {
    renderModal({ xdr: SAMPLE_XDR, isSigned: false });
    expect(screen.getByText(/unsigned/i)).toBeInTheDocument();
  });

  // ── Network passphrase / Stellar Lab URL ──────────────────────────────────
  it('opens Stellar Lab with network=testnet when isTestnet=true', () => {
    renderModal({ xdr: SAMPLE_XDR, isTestnet: true });
    fireEvent.click(screen.getByRole('button', { name: /open in lab/i }));
    expect(openSpy).toHaveBeenCalledOnce();
    const [url] = openSpy.mock.calls[0];
    expect(url).toContain('network=testnet');
    expect(url).not.toContain('network=public');
  });

  it('opens Stellar Lab with network=public when isTestnet=false', () => {
    renderModal({ xdr: SAMPLE_XDR, isTestnet: false });
    fireEvent.click(screen.getByRole('button', { name: /open in lab/i }));
    expect(openSpy).toHaveBeenCalledOnce();
    const [url] = openSpy.mock.calls[0];
    expect(url).toContain('network=public');
    expect(url).not.toContain('network=testnet');
  });

  it('uses noopener,noreferrer when opening in lab', () => {
    renderModal({ xdr: SAMPLE_XDR, isTestnet: false });
    fireEvent.click(screen.getByRole('button', { name: /open in lab/i }));
    const [, , features] = openSpy.mock.calls[0];
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  // ── Download ───────────────────────────────────────────────────────────────
  it('triggers a file download with a .xdr filename', () => {
    // Stub URL / anchor download chain
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickSpy,
      style: {},
    });
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => {});

    renderModal({ xdr: SAMPLE_XDR });
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(clickSpy).toHaveBeenCalledOnce();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  // ── Close ──────────────────────────────────────────────────────────────────
  it('calls onClose when the modal close button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ xdr: SAMPLE_XDR, onClose });
    fireEvent.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the Cancel/Close action button is clicked', () => {
    const onClose = vi.fn();
    renderModal({ xdr: SAMPLE_XDR, onClose });
    // The in-modal close action button
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
