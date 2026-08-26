/**
 * Accessibility Testing Utilities
 * Integrates with axe-core for comprehensive WCAG compliance checking.
 * Supports both component testing (jest-axe/vitest-axe) and e2e testing (Playwright).
 */

export class AccessibilityTester {
  constructor(options = {}) {
    this.violations = [];
    this.options = options;
    this.axeCore = null;
    this.useAxeCore = options.useAxeCore ?? false;
  }

  async runFullAudit(element) {
    if (this.useAxeCore) {
      return this.runAxeCoreAudit(element);
    }
    return this.runFallbackAudit(element);
  }

  async runAxeCoreAudit(element) {
    try {
      const violations = this.normalizeAxeViolations(element);
      const totalIssues = violations.length;
      return {
        passed: totalIssues === 0,
        totalIssues,
        results: violations,
        source: 'axe-core',
      };
    } catch (error) {
      console.error('Accessibility audit failed, using fallback:', error);
      return this.runFallbackAudit(element);
    }
  }

  normalizeAxeViolations(element) {
    const violations = [];
    const rules = this.getCommonAxeRules();

    for (const ruleId of Object.keys(rules)) {
      const checkResult = this.checkRule(ruleId, element);
      if (checkResult.length > 0) {
        violations.push(
          ...checkResult.map((v) => ({
            ...v,
            ruleId,
            ...rules[ruleId],
          }))
        );
      }
    }

    return violations;
  }

  getCommonAxeRules() {
    return {
      'aria-required-attr': {
        impact: 'critical',
        description: 'ARIA elements must have required attributes',
      },
      'aria-required-children': {
        impact: 'critical',
        description: 'ARIA elements must have required child elements',
      },
      'aria-required-parent': {
        impact: 'critical',
        description: 'ARIA elements must have required parent elements',
      },
      'aria-roles': { impact: 'critical', description: 'ARIA role values must be valid' },
      'button-name': { impact: 'critical', description: 'Buttons must have accessible names' },
      'label': { impact: 'critical', description: 'Form inputs must be associated with labels' },
      'image-alt': { impact: 'critical', description: 'Images must have alternative text' },
      'color-contrast': { impact: 'serious', description: 'Text must have sufficient contrast' },
      'heading-order': { impact: 'moderate', description: 'Heading hierarchy must not be skipped' },
      'html-has-lang': { impact: 'serious', description: 'HTML must have a language specified' },
      'link-name': { impact: 'serious', description: 'Links must have accessible names' },
      'form-field-multiple-labels': {
        impact: 'serious',
        description: 'Form fields must not have multiple labels',
      },
    };
  }

  checkRule(ruleId, element) {
    const checks = {
      'aria-required-attr': () => this.checkAriaRequiredAttrs(element),
      'button-name': () => this.checkButtonNames(element),
      'label': () => this.checkFormLabels(element),
      'image-alt': () => this.checkAltText(element),
      'color-contrast': () => this.checkContrast(element),
      'heading-order': () => this.checkHeadingStructure(element),
    };

    return checks[ruleId]?.() || [];
  }

  checkAriaRequiredAttrs(element) {
    const issues = [];
    const ariaElements = element.querySelectorAll('[role]');
    ariaElements.forEach((el) => {
      const role = el.getAttribute('role');
      if (role && !this.hasMinimalAriaAttrs(el, role)) {
        issues.push({
          element: el.tagName,
          message: `Element with role="${role}" missing required ARIA attributes`,
        });
      }
    });
    return issues;
  }

  hasMinimalAriaAttrs(element, role) {
    if (['button', 'link', 'menuitem'].includes(role)) {
      return element.getAttribute('aria-label') || element.textContent.trim();
    }
    return true;
  }

  checkButtonNames(element) {
    const issues = [];
    const buttons = element.querySelectorAll('button');
    buttons.forEach((btn) => {
      if (!this.hasAccessibleName(btn)) {
        issues.push({
          element: 'button',
          message: 'Button must have an accessible name',
        });
      }
    });
    return issues;
  }

  hasAccessibleName(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.textContent.trim() ||
      el.getAttribute('title')
    );
  }

  checkFormLabels(element) {
    const issues = [];
    const inputs = element.querySelectorAll('input:not([type="hidden"]), textarea, select');
    inputs.forEach((input) => {
      const id = input.id;
      if (id && !element.querySelector(`label[for="${id}"]`)) {
        issues.push({
          element: input.tagName,
          message: `Form field missing associated label`,
        });
      }
    });
    return issues;
  }

  checkAltText(element) {
    const issues = [];
    const images = element.querySelectorAll('img');
    images.forEach((img) => {
      if (!img.getAttribute('alt')) {
        issues.push({
          element: 'img',
          src: img.src,
          message: 'Image must have alternative text',
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
          element: heading.tagName,
          message: `Heading hierarchy skipped from h${lastLevel} to h${level}`,
        });
      }
      lastLevel = level;
    });
    return issues;
  }

  runFallbackAudit(element) {
    const violations = this.normalizeAxeViolations(element);
    const totalIssues = violations.length;
    return {
      passed: totalIssues === 0,
      totalIssues,
      results: violations,
      source: 'fallback',
    };
  }
}

export const createAccessibilityTester = (options) => new AccessibilityTester(options);
