/**
 * Main Microservices Export
 * Centralized access to active microservices utilities.
 *
 * Removed in Issue #1126 (prune unwired subsystems):
 *   - communication.js — unwired inter-service messaging helpers
 *   - discovery.js     — unwired service registry / discovery
 *   - gateway.js       — unwired API gateway layer
 *   - tracing.js       — unwired distributed tracing helpers
 *   - mesh.js          — unwired service-mesh helpers
 *
 * Retained active implementations:
 *   - boundaries.js   — service boundary / contract definitions
 *   - monitor.js      — in-process service health monitoring
 *   - deployment.js   — deployment pipeline helpers
 */

export * from './boundaries.js';
export * from './monitor.js';
export * from './deployment.js';
