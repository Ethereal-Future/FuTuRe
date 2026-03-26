/**
 * Accessibility Testing Utilities
 * Automated accessibility checks for components
 */

export class AccessibilityTester {
  constructor() {
    this.violations = [];
  }

  checkAriaLabels(element) {
    const issues = [];
    const interactiveElements = element.querySelectorAll('button, a, input, select, textarea');

    interactiveElements.forEach((el) => {
      const hasLabel =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.textContent.trim() ||
        el.getAttribute('title');

      if (!hasLabel) {
        issues.push({
          type: 'missing-aria-label',
          element: el.tagName,
          message: `${el.tagName} missing accessible label`,
        });
      }
    });

    return issues;
  }

  checkContrast(element) {
    const issues = [];
    const elements = element.querySelectorAll('*');

    elements.forEach((el) => {
      const style = window.getComputedStyle(el);
      const bgColor = style.backgroundColor;
      const color = style.color;

      if (bgColor && color && bgColor !== 'rgba(0, 0, 0, 0)') {
        const contrast = this.calculateContrast(bgColor, color);
        if (contrast < 4.5) {
          issues.push({
            type: 'low-contrast',
            element: el.tagName,
            contrast: contrast.toFixed(2),
            message: `Low contrast ratio: ${contrast.toFixed(2)}:1 (minimum 4.5:1)`,
          });
        }
      }
    });

    return issues;
  }

  calculateContrast(bgColor, fgColor) {
    const bg = this.parseColor(bgColor);
    const fg = this.parseColor(fgColor);

    const bgLum = this.getLuminance(bg);
    const fgLum = this.getLuminance(fg);

    const lighter = Math.max(bgLum, fgLum);
    const darker = Math.min(bgLum, fgLum);

    return (lighter + 0.05) / (darker + 0.05);
  }

  parseColor(color) {
    const match = color.match(/\d+/g);
    return match ? match.slice(0, 3).map(Number) : [0, 0, 0];
  }

  getLuminance([r, g, b]) {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  checkHeadingStructure(element) {
    const issues = [];
    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let lastLevel = 0;

    headings.forEach((heading) => {
      const level = parseInt(heading.tagName[1]);
      if (level - lastLevel > 1) {
        issues.push({
          type: 'heading-hierarchy',
          element: heading.tagName,
          message: `Heading hierarchy skipped from h${lastLevel} to h${level}`,
        });
      }
      lastLevel = level;
    });

    return issues;
  }

  checkAltText(element) {
    const issues = [];
    const images = element.querySelectorAll('img');

    images.forEach((img) => {
      if (!img.getAttribute('alt')) {
        issues.push({
          type: 'missing-alt-text',
          element: 'img',
          src: img.src,
          message: 'Image missing alt text',
        });
      }
    });

    return issues;
  }

  runFullAudit(element) {
    const results = {
      ariaLabels: this.checkAriaLabels(element),
      contrast: this.checkContrast(element),
      headingStructure: this.checkHeadingStructure(element),
      altText: this.checkAltText(element),
    };

    const totalIssues = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    return {
      passed: totalIssues === 0,
      totalIssues,
      results,
    };
  }
}

export const createAccessibilityTester = () => new AccessibilityTester();
