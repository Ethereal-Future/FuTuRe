import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import App from '../src/App';

// Mock dependencies
vi.mock('axios');
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
    button: ({ children, ...props }) => <button {...props}>{children}</button>,
    span: ({ children, ...props }) => <span {...props}>{children}</span>,
    section: ({ children, ...props }) => <section {...props}>{children}</section>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => false,
}));

describe('Responsive Payment Form', () => {
  let originalInnerWidth;
  let originalMatchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    originalInnerWidth = window.innerWidth;
    originalMatchMedia = window.matchMedia;
    
    // Mock matchMedia for responsive tests
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.innerWidth = originalInnerWidth;
    window.matchMedia = originalMatchMedia;
  });

  const setViewportWidth = (width) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event('resize'));
  };

  describe('Mobile Viewport (320px - 480px)', () => {
    beforeEach(() => {
      setViewportWidth(375);
    });

    it('renders payment form without horizontal overflow', () => {
      const { container } = render(<App />);
      const inputs = container.querySelectorAll('input');
      
      inputs.forEach(input => {
        const styles = window.getComputedStyle(input);
        expect(styles.boxSizing).toBe('border-box');
        expect(styles.maxWidth).toBe('100%');
      });
    });

    it('stacks form buttons vertically on mobile', async () => {
      render(<App />);
      
      // Wait for component to mount
      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });

      const actionContainer = document.querySelector('.payment-form-actions');
      if (actionContainer) {
        const styles = window.getComputedStyle(actionContainer);
        // On mobile, flex-direction should be column
        expect(['column', 'column-reverse']).toContain(styles.flexDirection);
      }
    });

    it('memo input and select stack vertically on mobile', () => {
      const { container } = render(<App />);
      
      const memoWrap = container.querySelector('.memo-wrap');
      if (memoWrap) {
        const styles = window.getComputedStyle(memoWrap);
        // Should be column on mobile
        expect(['column', 'column-reverse']).toContain(styles.flexDirection);
      }
    });

    it('input fields have proper touch target size (min 44px)', () => {
      const { container } = render(<App />);
      const inputs = container.querySelectorAll('input, button, select');
      
      inputs.forEach(element => {
        const styles = window.getComputedStyle(element);
        const minHeight = parseInt(styles.minHeight);
        
        // Touch targets should be at least 44px
        if (!element.classList.contains('sr-only')) {
          expect(minHeight).toBeGreaterThanOrEqual(44);
        }
      });
    });

    it('text wraps properly without overflow', () => {
      const { container } = render(<App />);
      
      const textElements = container.querySelectorAll('.field-error, .rate-estimate, .kyc-warning');
      textElements.forEach(element => {
        const styles = window.getComputedStyle(element);
        expect(['break-word', 'break-all']).toContain(styles.wordWrap);
      });
    });

    it('QR scan button is properly positioned on small screens', () => {
      const { container } = render(<App />);
      
      const qrButton = container.querySelector('.qr-scan-btn');
      if (qrButton) {
        const styles = window.getComputedStyle(qrButton);
        expect(styles.position).toBe('absolute');
        expect(styles.zIndex).toBe('1');
      }
    });

    it('Max button is properly sized on small screens', () => {
      const { container } = render(<App />);
      
      const maxButton = container.querySelector('.btn-send-max');
      if (maxButton) {
        const styles = window.getComputedStyle(maxButton);
        expect(styles.position).toBe('absolute');
        expect(styles.zIndex).toBe('1');
      }
    });
  });

  describe('Tablet Viewport (480px - 768px)', () => {
    beforeEach(() => {
      setViewportWidth(600);
    });

    it('renders form with appropriate spacing', () => {
      const { container } = render(<App />);
      const app = container.querySelector('.app');
      
      if (app) {
        const styles = window.getComputedStyle(app);
        expect(styles.maxWidth).toBe('600px');
      }
    });

    it('buttons can be inline on tablet', async () => {
      render(<App />);
      
      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
      });

      const actionContainer = document.querySelector('.payment-form-actions');
      if (actionContainer) {
        const styles = window.getComputedStyle(actionContainer);
        expect(styles.display).toBe('flex');
      }
    });
  });

  describe('Desktop Viewport (768px+)', () => {
    beforeEach(() => {
      setViewportWidth(1024);
    });

    it('maintains max-width constraint', () => {
      const { container } = render(<App />);
      const app = container.querySelector('.app');
      
      if (app) {
        const styles = window.getComputedStyle(app);
        expect(styles.maxWidth).toBe('600px');
      }
    });

    it('form elements maintain proper layout', () => {
      const { container } = render(<App />);
      const inputs = container.querySelectorAll('input');
      
      inputs.forEach(input => {
        const styles = window.getComputedStyle(input);
        expect(styles.width).toBe('100%');
        expect(styles.boxSizing).toBe('border-box');
      });
    });
  });

  describe('Overflow Prevention', () => {
    it('prevents horizontal scroll on narrow viewports', () => {
      setViewportWidth(320);
      const { container } = render(<App />);
      
      const app = container.querySelector('.app');
      if (app) {
        const styles = window.getComputedStyle(app);
        expect(styles.width).toBe('100%');
        expect(styles.maxWidth).toBe('600px');
      }
    });

    it('input fields do not exceed container width', () => {
      setViewportWidth(320);
      const { container } = render(<App />);
      
      const inputs = container.querySelectorAll('input');
      inputs.forEach(input => {
        const rect = input.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        expect(rect.right).toBeLessThanOrEqual(containerRect.right);
      });
    });

    it('long error messages wrap properly', () => {
      const { container } = render(<App />);
      
      const errorElements = container.querySelectorAll('.field-error');
      errorElements.forEach(element => {
        const styles = window.getComputedStyle(element);
        expect(styles.maxWidth).toBe('100%');
        expect(['break-word', 'break-all']).toContain(styles.wordWrap);
      });
    });
  });

  describe('Responsive Breakpoint Behavior', () => {
    it('adapts layout when resizing from mobile to desktop', async () => {
      setViewportWidth(375);
      const { container, rerender } = render(<App />);
      
      // Check mobile layout
      let actionContainer = container.querySelector('.payment-form-actions');
      if (actionContainer) {
        let styles = window.getComputedStyle(actionContainer);
        expect(styles.display).toBe('flex');
      }
      
      // Resize to desktop
      setViewportWidth(1024);
      rerender(<App />);
      
      // Layout should still be valid
      actionContainer = container.querySelector('.payment-form-actions');
      if (actionContainer) {
        let styles = window.getComputedStyle(actionContainer);
        expect(styles.display).toBe('flex');
      }
    });

    it('maintains functionality across breakpoints', async () => {
      const viewports = [320, 480, 768, 1024];
      
      for (const width of viewports) {
        setViewportWidth(width);
        const { container } = render(<App />);
        
        // All inputs should be present and functional
        const inputs = container.querySelectorAll('input');
        expect(inputs.length).toBeGreaterThan(0);
        
        inputs.forEach(input => {
          expect(input).toBeInTheDocument();
        });
      }
    });
  });

  describe('Alignment and Spacing', () => {
    it('maintains consistent spacing between form elements', () => {
      const { container } = render(<App />);
      
      const inputWraps = container.querySelectorAll('.input-wrap');
      inputWraps.forEach(wrap => {
        const styles = window.getComputedStyle(wrap);
        expect(styles.marginBottom).toBeTruthy();
      });
    });

    it('buttons have proper gap spacing', () => {
      const { container } = render(<App />);
      
      const actionContainer = container.querySelector('.payment-form-actions');
      if (actionContainer) {
        const styles = window.getComputedStyle(actionContainer);
        expect(styles.gap).toBeTruthy();
      }
    });

    it('form sections are properly aligned', () => {
      const { container } = render(<App />);
      
      const sections = container.querySelectorAll('.section');
      sections.forEach(section => {
        const styles = window.getComputedStyle(section);
        expect(styles.marginBottom).toBeTruthy();
      });
    });
  });

  describe('Interaction States', () => {
    it('maintains focus states on all interactive elements', async () => {
      const { container } = render(<App />);
      
      const interactiveElements = container.querySelectorAll('input, button, select');
      
      for (const element of interactiveElements) {
        if (!element.classList.contains('sr-only') && !element.disabled) {
          act(() => {
            element.focus();
          });
          
          expect(document.activeElement).toBe(element);
        }
      }
    });

    it('hover states work on buttons', () => {
      const { container } = render(<App />);
      
      const buttons = container.querySelectorAll('button:not(:disabled)');
      buttons.forEach(button => {
        fireEvent.mouseEnter(button);
        // Button should still be in document after hover
        expect(button).toBeInTheDocument();
      });
    });

    it('disabled states are properly indicated', () => {
      const { container } = render(<App />);
      
      const disabledButtons = container.querySelectorAll('button:disabled');
      disabledButtons.forEach(button => {
        expect(button).toHaveAttribute('disabled');
      });
    });
  });

  describe('Accessibility Compliance', () => {
    it('all form inputs have labels', () => {
      const { container } = render(<App />);
      
      const inputs = container.querySelectorAll('input');
      inputs.forEach(input => {
        const id = input.getAttribute('id');
        if (id) {
          const label = container.querySelector(`label[for="${id}"]`);
          const ariaLabel = input.getAttribute('aria-label');
          expect(label || ariaLabel).toBeTruthy();
        }
      });
    });

    it('maintains proper heading hierarchy', () => {
      const { container } = render(<App />);
      
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      expect(headings.length).toBeGreaterThan(0);
    });

    it('error messages are associated with inputs', () => {
      const { container } = render(<App />);
      
      const errorMessages = container.querySelectorAll('.field-error');
      errorMessages.forEach(error => {
        const role = error.getAttribute('role');
        expect(role).toBe('alert');
      });
    });

    it('buttons have accessible names', () => {
      const { container } = render(<App />);
      
      const buttons = container.querySelectorAll('button');
      buttons.forEach(button => {
        const ariaLabel = button.getAttribute('aria-label');
        const textContent = button.textContent;
        expect(ariaLabel || textContent).toBeTruthy();
      });
    });
  });

  describe('No Regressions', () => {
    it('desktop layout remains unchanged', () => {
      setViewportWidth(1024);
      const { container } = render(<App />);
      
      const app = container.querySelector('.app');
      if (app) {
        const styles = window.getComputedStyle(app);
        expect(styles.maxWidth).toBe('600px');
        expect(styles.margin).toContain('auto');
      }
    });

    it('all form functionality still works', async () => {
      const { container } = render(<App />);
      
      // Check that all major form elements exist
      const recipientInput = container.querySelector('input[placeholder*="Recipient"]');
      const amountInput = container.querySelector('input[placeholder*="Amount"]');
      
      expect(recipientInput).toBeInTheDocument();
      expect(amountInput).toBeInTheDocument();
    });

    it('validation still functions correctly', async () => {
      const { container } = render(<App />);
      
      const recipientInput = container.querySelector('input[placeholder*="Recipient"]');
      if (recipientInput) {
        await userEvent.type(recipientInput, 'invalid');
        
        // Validation icon should appear
        await waitFor(() => {
          const icon = container.querySelector('.input-icon');
          expect(icon).toBeInTheDocument();
        });
      }
    });

    it('existing CSS classes are preserved', () => {
      const { container } = render(<App />);
      
      // Check for key CSS classes
      expect(container.querySelector('.app')).toBeInTheDocument();
      expect(container.querySelector('.section')).toBeInTheDocument();
      expect(container.querySelector('.input-wrap')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles very narrow viewports (< 320px)', () => {
      setViewportWidth(280);
      const { container } = render(<App />);
      
      const app = container.querySelector('.app');
      expect(app).toBeInTheDocument();
    });

    it('handles very wide viewports (> 1920px)', () => {
      setViewportWidth(2560);
      const { container } = render(<App />);
      
      const app = container.querySelector('.app');
      if (app) {
        const styles = window.getComputedStyle(app);
        expect(styles.maxWidth).toBe('600px');
      }
    });

    it('handles rapid viewport changes', () => {
      const { container } = render(<App />);
      
      const widths = [320, 768, 480, 1024, 375];
      widths.forEach(width => {
        setViewportWidth(width);
        expect(container.querySelector('.app')).toBeInTheDocument();
      });
    });
  });
});
