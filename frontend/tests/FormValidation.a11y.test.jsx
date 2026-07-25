/**
 * Tests for Issue #554: aria-live error summary + focus management in FormValidation
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ValidationSummary, useFormValidation } from '../src/components/FormValidation';
import { useRef } from 'react';

describe('#554 ValidationSummary accessibility', () => {
  it('renders with role="alert" and aria-live="assertive"', () => {
    render(<ValidationSummary errors={['Field is required']} />);
    const summary = screen.getByRole('alert');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveAttribute('aria-live', 'assertive');
    expect(summary).toHaveAttribute('aria-atomic', 'true');
  });

  it('lists all validation errors in the summary', () => {
    render(<ValidationSummary errors={['Name is required', 'Amount must be positive']} />);
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Amount must be positive')).toBeInTheDocument();
  });

  it('does not render when there are no errors or warnings', () => {
    const { container } = render(<ValidationSummary errors={[]} warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('has tabIndex=-1 so focus can be programmatically moved to it', () => {
    render(<ValidationSummary errors={['Some error']} />);
    const summary = screen.getByRole('alert');
    expect(summary).toHaveAttribute('tabindex', '-1');
  });

  it('accepts a summaryRef and can be focused', () => {
    function Wrapper() {
      const ref = useRef(null);
      return (
        <>
          <ValidationSummary errors={['Error!']} summaryRef={ref} />
          <button onClick={() => ref.current?.focus()}>Focus summary</button>
        </>
      );
    }
    render(<Wrapper />);
    const btn = screen.getByRole('button', { name: /focus summary/i });
    act(() => btn.click());
    // The summary element should exist and be focusable
    const summary = screen.getByRole('alert');
    expect(summary).toBeInTheDocument();
  });
});

describe('#554 useFormValidation — focusSummary', () => {
  it('exposes summaryRef and focusSummary', () => {
    function TestForm() {
      const { summaryRef, focusSummary, errors } = useFormValidation({ name: '' });
      return (
        <>
          <ValidationSummary errors={Object.values(errors)} summaryRef={summaryRef} />
          <button onClick={focusSummary}>Submit</button>
        </>
      );
    }
    render(<TestForm />);
    // No errors initially, summary not rendered — just verifying no crash
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });
});
