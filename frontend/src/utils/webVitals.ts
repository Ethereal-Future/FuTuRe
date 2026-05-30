import type { Metric } from 'web-vitals';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';

interface VitalEntry {
  name: string;
  value: number;
  rating: string;
  budget: number | undefined;
  over: boolean;
}

declare global {
  interface Window {
    __reportVital?: (entry: VitalEntry) => void;
  }
}

// Performance budgets — alert if exceeded
const BUDGETS: Record<string, number> = {
  CLS:  0.1,
  FCP:  1800,
  INP:  200,
  LCP:  2500,
  TTFB: 800,
};

function report(metric: Metric): void {
  const budget = BUDGETS[metric.name];
  const over = budget != null && metric.value > budget;

  const entry: VitalEntry = {
    name:   metric.name,
    value:  Math.round(metric.value),
    rating: metric.rating,       // 'good' | 'needs-improvement' | 'poor'
    budget,
    over,
  };

  // Log to console (replace with analytics endpoint as needed)
  if (over) {
    console.warn(`[Perf] ⚠️ ${entry.name} ${entry.value} exceeds budget ${budget}`, entry);
  } else {
    console.info(`[Perf] ${entry.name} ${entry.value} (${entry.rating})`, entry);
  }

  // Hook for external analytics: window.__reportVital?.(entry)
  window.__reportVital?.(entry);
}

export function initWebVitals(): void {
  onCLS(report);
  onFCP(report);
  onINP(report);
  onLCP(report);
  onTTFB(report);
}
