import { describe, it, expect } from 'vitest';
import assetsRoutes from '../src/routes/assets.js';

describe('Assets Route', () => {
  it('should export a router', () => {
    expect(assetsRoutes).toBeDefined();
    expect(assetsRoutes.stack).toBeDefined();
  });

  it('should have GET / endpoint', () => {
    const hasGetRoot = assetsRoutes.stack.some(
      layer => layer.route && layer.route.path === '/' && layer.route.methods.get
    );
    expect(hasGetRoot).toBe(true);
  });

  it('should have POST /register endpoint', () => {
    const hasPostRegister = assetsRoutes.stack.some(
      layer => layer.route && layer.route.path === '/register' && layer.route.methods.post
    );
    expect(hasPostRegister).toBe(true);
  });

  it('should have GET /trustlines/:address endpoint', () => {
    const hasTrustlines = assetsRoutes.stack.some(
      layer => layer.route && layer.route.path === '/trustlines/:address' && layer.route.methods.get
    );
    expect(hasTrustlines).toBe(true);
  });

  it('should have GET /portfolio/:address endpoint', () => {
    const hasPortfolio = assetsRoutes.stack.some(
      layer => layer.route && layer.route.path === '/portfolio/:address' && layer.route.methods.get
    );
    expect(hasPortfolio).toBe(true);
  });
});
