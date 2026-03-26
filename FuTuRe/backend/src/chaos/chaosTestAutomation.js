import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPERIMENTS_DIR = path.join(__dirname, '../../data/chaos/experiments');
const REPORTS_DIR = path.join(__dirname, '../../data/chaos/reports');

class ChaosTestAutomation {
  constructor() {
    this.experiments = new Map();
    this.schedules = new Map();
  }

  async createExperiment(name, description, failureInjections, duration = 60000) {
    await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });

    const experiment = {
      id: `exp-${Date.now()}`,
      name,
      description,
      failureInjections,
      duration,
      createdAt: new Date().toISOString(),
      status: 'CREATED'
    };

    this.experiments.set(experiment.id, experiment);

    const file = path.join(EXPERIMENTS_DIR, `${experiment.id}.json`);
    await fs.writeFile(file, JSON.stringify(experiment, null, 2));

    return experiment;
  }

  async runExperiment(experimentId, callbacks = {}) {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error('Experiment not found');
    }

    experiment.status = 'RUNNING';
    experiment.startTime = Date.now();

    if (callbacks.onStart) {
      await callbacks.onStart(experiment);
    }

    // Simulate experiment execution
    await new Promise(resolve => setTimeout(resolve, experiment.duration));

    experiment.status = 'COMPLETED';
    experiment.endTime = Date.now();

    if (callbacks.onComplete) {
      await callbacks.onComplete(experiment);
    }

    return experiment;
  }

  scheduleExperiment(experimentId, cronExpression) {
    const schedule = {
      experimentId,
      cronExpression,
      createdAt: new Date().toISOString(),
      enabled: true,
      lastRun: null,
      nextRun: this.calculateNextRun(cronExpression)
    };

    this.schedules.set(experimentId, schedule);
    return schedule;
  }

  calculateNextRun(cronExpression) {
    // Simplified: just add 1 day
    const next = new Date();
    next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  getScheduledExperiments() {
    return Array.from(this.schedules.values());
  }

  async getExperiment(experimentId) {
    return this.experiments.get(experimentId);
  }

  async getAllExperiments() {
    try {
      await fs.mkdir(EXPERIMENTS_DIR, { recursive: true });
      const files = await fs.readdir(EXPERIMENTS_DIR);
      const experiments = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(EXPERIMENTS_DIR, file), 'utf-8');
        experiments.push(JSON.parse(content));
      }

      return experiments;
    } catch (error) {
      return [];
    }
  }

  async saveExperimentResult(experimentId, result) {
    await fs.mkdir(REPORTS_DIR, { recursive: true });

    const report = {
      experimentId,
      result,
      timestamp: new Date().toISOString()
    };

    const file = path.join(REPORTS_DIR, `${experimentId}-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(report, null, 2));

    return report;
  }
}

export default new ChaosTestAutomation();
