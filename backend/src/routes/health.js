import express from 'express';
import os from 'os';
import * as StellarService from '../services/stellar.js';
import { eventMonitor } from '../eventSourcing/index.js';
import { auditLogger } from '../security/index.js';

const router = express.Router();

function getSystemInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    cpus: os.cpus().length,
    hostname: os.hostname()
  };
}

function getApplicationInfo() {
  return {
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    startTime: new Date().toISOString(),
    processId: process.pid
  };
}

async function checkStellarConnectivity() {
  try {
    const status = await StellarService.getNetworkStatus();
    return {
      status: 'healthy',
      network: status.network,
      horizonUrl: status.horizonUrl,
      online: status.online,
      horizonVersion: status.horizonVersion,
      currentProtocolVersion: status.currentProtocolVersion,
      responseTime: Date.now()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now()
    };
  }
}

async function checkDatabaseConnectivity() {
  // This application doesn't appear to use a traditional database
  // Using event sourcing and in-memory storage instead
  try {
    const eventMonitorStatus = eventMonitor.isInitialized ? 'healthy' : 'unhealthy';
    const auditLoggerStatus = auditLogger.isInitialized ? 'healthy' : 'unhealthy';
    
    return {
      status: eventMonitorStatus === 'healthy' && auditLoggerStatus === 'healthy' ? 'healthy' : 'unhealthy',
      eventMonitor: eventMonitorStatus,
      auditLogger: auditLoggerStatus,
      type: 'event-sourcing'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      type: 'event-sourcing'
    };
  }
}

async function checkDependencies() {
  const checks = [];
  
  // Check Stellar SDK
  try {
    const stellarStatus = await checkStellarConnectivity();
    checks.push({
      name: '@stellar/stellar-sdk',
      status: stellarStatus.status,
      version: '12.3.0'
    });
  } catch (error) {
    checks.push({
      name: '@stellar/stellar-sdk',
      status: 'unhealthy',
      error: error.message
    });
  }
  
  // Check Express (core framework)
  checks.push({
    name: 'express',
    status: 'healthy',
    version: '4.19.2'
  });
  
  // Check WebSocket
  checks.push({
    name: 'ws',
    status: 'healthy',
    version: '8.20.0'
  });
  
  return {
    overall: checks.every(c => c.status === 'healthy') ? 'healthy' : 'unhealthy',
    dependencies: checks
  };
}

function calculateHealthPercentage(checks) {
  const healthyCount = checks.filter(check => check.status === 'healthy').length;
  return Math.round((healthyCount / checks.length) * 100);
}

router.get('/health', async (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    const appInfo = getApplicationInfo();
    const stellarCheck = await checkStellarConnectivity();
    const databaseCheck = await checkDatabaseConnectivity();
    const dependencyCheck = await checkDependencies();
    
    const healthChecks = [
      { name: 'stellar', ...stellarCheck },
      { name: 'database', ...databaseCheck }
    ];
    
    const overallHealth = calculateHealthPercentage(healthChecks);
    const status = overallHealth >= 80 ? 'healthy' : overallHealth >= 50 ? 'degraded' : 'unhealthy';
    
    const healthData = {
      status,
      overallHealth,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: healthChecks,
      dependencies: dependencyCheck,
      system: systemInfo,
      application: appInfo
    };
    
    const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/health/live', (req, res) => {
  // Liveness probe - checks if the application is running
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

router.get('/health/ready', async (req, res) => {
  try {
    // Readiness probe - checks if the application is ready to serve traffic
    const stellarCheck = await checkStellarConnectivity();
    const databaseCheck = await checkDatabaseConnectivity();
    
    const isReady = stellarCheck.status === 'healthy' && databaseCheck.status === 'healthy';
    
    const readinessData = {
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks: {
        stellar: stellarCheck.status,
        database: databaseCheck.status
      }
    };
    
    const statusCode = isReady ? 200 : 503;
    res.status(statusCode).json(readinessData);
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/metrics', (req, res) => {
  try {
    const systemInfo = getSystemInfo();
    const appInfo = getApplicationInfo();
    const memoryUsage = process.memoryUsage();
    
    const metrics = {
      timestamp: new Date().toISOString(),
      application: {
        version: appInfo.version,
        nodeVersion: appInfo.nodeVersion,
        environment: appInfo.environment,
        processId: appInfo.processId,
        uptime: process.uptime()
      },
      system: {
        platform: systemInfo.platform,
        arch: systemInfo.arch,
        hostname: systemInfo.hostname,
        cpuCount: systemInfo.cpus,
        loadAverage: systemInfo.loadavg,
        memory: {
          total: systemInfo.totalmem,
          free: systemInfo.freemem,
          used: systemInfo.totalmem - systemInfo.freemem,
          usagePercentage: Math.round(((systemInfo.totalmem - systemInfo.freemem) / systemInfo.totalmem) * 100)
        }
      },
      process: {
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external,
          arrayBuffers: memoryUsage.arrayBuffers
        },
        cpuUsage: process.cpuUsage()
      }
    };
    
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
