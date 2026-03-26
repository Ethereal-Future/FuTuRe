import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(__dirname, '../../data/load-tests/scenarios');

class LoadTestScenario {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.requests = [];
    this.duration = 60; // seconds
    this.rampUp = 10; // seconds
    this.concurrency = 10;
  }

  addRequest(method, path, body = null, weight = 1) {
    this.requests.push({ method, path, body, weight });
    return this;
  }

  setDuration(seconds) {
    this.duration = seconds;
    return this;
  }

  setRampUp(seconds) {
    this.rampUp = seconds;
    return this;
  }

  setConcurrency(count) {
    this.concurrency = count;
    return this;
  }

  async save() {
    await fs.mkdir(SCENARIOS_DIR, { recursive: true });
    const file = path.join(SCENARIOS_DIR, `${this.name}.json`);
    await fs.writeFile(file, JSON.stringify(this, null, 2));
  }

  static async load(name) {
    const file = path.join(SCENARIOS_DIR, `${name}.json`);
    const content = await fs.readFile(file, 'utf-8');
    const data = JSON.parse(content);
    const scenario = new LoadTestScenario(data.name, data.description);
    scenario.requests = data.requests;
    scenario.duration = data.duration;
    scenario.rampUp = data.rampUp;
    scenario.concurrency = data.concurrency;
    return scenario;
  }
}

export default LoadTestScenario;
