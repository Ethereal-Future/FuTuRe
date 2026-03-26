/**
 * Example: Using Accessibility Testing
 * Demonstrates automated accessibility checks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAccessibilityTester } from '../../testing/accessibility.js';
import { JSDOM } from 'jsdom';

describe('Accessibility Testing', () => {
  let tester;
  let dom;

  beforeEach(() => {
    tester = createAccessibilityTester();
    dom = new JSDOM();
  });

  it('should detect missing aria labels', () => {
    const html = `
      <div>
        <button>Click me</button>
        <button></button>
      </div>
    `;
    const dom = new JSDOM(html);
    const issues = tester.checkAriaLabels(dom.window.document.body);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('should check heading hierarchy', () => {
    const html = `
      <div>
        <h1>Title</h1>
        <h3>Subtitle</h3>
      </div>
    `;
    const dom = new JSDOM(html);
    const issues = tester.checkHeadingStructure(dom.window.document.body);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('should detect missing alt text on images', () => {
    const html = `
      <div>
        <img src="test.jpg" />
        <img src="test2.jpg" alt="Test image" />
      </div>
    `;
    const dom = new JSDOM(html);
    const issues = tester.checkAltText(dom.window.document.body);
    expect(issues.length).toBe(1);
  });

  it('should run full accessibility audit', () => {
    const html = `
      <div>
        <h1>Main Title</h1>
        <button>Action</button>
        <img src="test.jpg" alt="Test" />
      </div>
    `;
    const dom = new JSDOM(html);
    const audit = tester.runFullAudit(dom.window.document.body);
    expect(audit).toHaveProperty('passed');
    expect(audit).toHaveProperty('totalIssues');
    expect(audit).toHaveProperty('results');
  });
});
