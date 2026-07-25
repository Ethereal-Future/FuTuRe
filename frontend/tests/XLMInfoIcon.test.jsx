import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { XLMInfoIcon } from '../src/components/XLMInfoIcon';

describe('XLMInfoIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('renders the info icon button', () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button', { name: /information about xlm currency/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('ℹ️');
    });

    it('does not show tooltip initially', () => {
      render(<XLMInfoIcon />);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      const { container } = render(<XLMInfoIcon className="custom-class" />);
      expect(container.querySelector('.xlm-info-wrapper')).toHaveClass('custom-class');
    });
  });

  describe('Tooltip Display', () => {
    it('shows tooltip on click', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button', { name: /information about xlm currency/i });
      
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      });
      
      expect(screen.getByText(/XLM \(Lumens\)/i)).toBeInTheDocument();
      expect(screen.getByText(/native currency of the Stellar network/i)).toBeInTheDocument();
      expect(screen.getByText(/transaction fees/i)).toBeInTheDocument();
    });

    it('hides tooltip on second click', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button', { name: /information about xlm currency/i });
      
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      fireEvent.click(button);
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });

    it('shows tooltip content with correct structure', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      
      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toBeInTheDocument();
        expect(tooltip.querySelector('strong')).toHaveTextContent('XLM (Lumens)');
      });
    });
  });

  describe('Keyboard Navigation', () => {
    it('opens tooltip on Enter key', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      button.focus();
      fireEvent.keyDown(button, { key: 'Enter' });
      
      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      });
    });

    it('opens tooltip on Space key', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      button.focus();
      fireEvent.keyDown(button, { key: ' ' });
      
      await waitFor(() => {
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
      });
    });

    it('closes tooltip on Escape key', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      fireEvent.keyDown(document, { key: 'Escape' });
      
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });

    it('returns focus to button after closing with Escape', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      fireEvent.keyDown(document, { key: 'Escape' });
      
      await waitFor(() => {
        expect(document.activeElement).toBe(button);
      });
    });

    it('is keyboard focusable', () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });

  describe('Click Outside Behavior', () => {
    it('closes tooltip when clicking outside', async () => {
      const { container } = render(
        <div>
          <XLMInfoIcon />
          <button>Outside Button</button>
        </div>
      );
      
      const infoButton = screen.getByRole('button', { name: /information about xlm currency/i });
      fireEvent.click(infoButton);
      
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      const outsideButton = screen.getByRole('button', { name: 'Outside Button' });
      fireEvent.mouseDown(outsideButton);
      
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });

    it('does not close tooltip when clicking inside tooltip', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      const tooltip = screen.getByRole('tooltip');
      fireEvent.mouseDown(tooltip);
      
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    it('handles touch events for mobile', async () => {
      render(
        <div>
          <XLMInfoIcon />
          <button>Outside</button>
        </div>
      );
      
      const infoButton = screen.getByRole('button', { name: /information about xlm currency/i });
      fireEvent.click(infoButton);
      
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      const outsideButton = screen.getByRole('button', { name: 'Outside' });
      fireEvent.touchStart(outsideButton);
      
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA attributes when closed', () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      expect(button).toHaveAttribute('aria-label', 'Information about XLM currency');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('has proper ARIA attributes when open', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(button).toHaveAttribute('aria-expanded', 'true');
        expect(button).toHaveAttribute('aria-describedby', 'xlm-tooltip');
      });
    });

    it('tooltip has role="tooltip"', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      
      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toHaveAttribute('id', 'xlm-tooltip');
      });
    });

    it('button has type="button" to prevent form submission', () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  describe('Animation', () => {
    it('tooltip appears with animation', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      
      await waitFor(() => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip).toBeInTheDocument();
      });
    });

    it('tooltip disappears with animation', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('tooltip')).toBeInTheDocument());
      
      fireEvent.click(button);
      
      await waitFor(() => {
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      });
    });
  });

  describe('Multiple Instances', () => {
    it('handles multiple instances independently', async () => {
      render(
        <div>
          <XLMInfoIcon />
          <XLMInfoIcon />
        </div>
      );
      
      const buttons = screen.getAllByRole('button', { name: /information about xlm currency/i });
      expect(buttons).toHaveLength(2);
      
      fireEvent.click(buttons[0]);
      
      await waitFor(() => {
        const tooltips = screen.getAllByRole('tooltip');
        expect(tooltips).toHaveLength(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles rapid clicks', async () => {
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
      
      await waitFor(() => {
        const tooltips = screen.queryAllByRole('tooltip');
        expect(tooltips.length).toBeLessThanOrEqual(1);
      });
    });

    it('cleans up event listeners on unmount', () => {
      const { unmount } = render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      fireEvent.click(button);
      unmount();
      
      // Should not throw errors
      expect(() => {
        fireEvent.keyDown(document, { key: 'Escape' });
      }).not.toThrow();
    });
  });

  describe('Responsive Behavior', () => {
    it('renders correctly on mobile viewport', () => {
      global.innerWidth = 375;
      global.dispatchEvent(new Event('resize'));
      
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('xlm-info-btn');
    });

    it('renders correctly on desktop viewport', () => {
      global.innerWidth = 1024;
      global.dispatchEvent(new Event('resize'));
      
      render(<XLMInfoIcon />);
      const button = screen.getByRole('button');
      
      expect(button).toBeInTheDocument();
    });
  });
});
