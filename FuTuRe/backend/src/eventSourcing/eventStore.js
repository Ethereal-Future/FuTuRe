import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = path.join(__dirname, '../../data/events');
const SNAPSHOTS_DIR = path.join(__dirname, '../../data/snapshots');

class EventStore {
  constructor() {
    this.events = [];
    this.initialized = false;
  }

  async initialize() {
    try {
      await fs.mkdir(EVENTS_DIR, { recursive: true });
      await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize event store:', error);
      throw error;
    }
  }

  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const eventWithMetadata = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      aggregateId,
      type: event.type,
      data: event.data,
      version: event.version || 1,
      timestamp: new Date().toISOString(),
      metadata: event.metadata || {}
    };

    const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
    await fs.appendFile(eventFile, JSON.stringify(eventWithMetadata) + '\n');
    this.events.push(eventWithMetadata);

    return eventWithMetadata;
  }

  async getEvents(aggregateId, fromVersion = 0) {
    if (!this.initialized) await this.initialize();

    const eventFile = path.join(EVENTS_DIR, `${aggregateId}.jsonl`);
    try {
      const content = await fs.readFile(eventFile, 'utf-8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .filter(event => event.version > fromVersion);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async getAllEvents(limit = 1000, offset = 0) {
    if (!this.initialized) await this.initialize();

    try {
      const files = await fs.readdir(EVENTS_DIR);
      const allEvents = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(EVENTS_DIR, file), 'utf-8');
        const events = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        allEvents.push(...events);
      }

      return allEvents
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(offset, offset + limit);
    } catch (error) {
      console.error('Failed to get all events:', error);
      return [];
    }
  }

  async saveSnapshot(aggregateId, state, version) {
    if (!this.initialized) await this.initialize();

    const snapshot = {
      aggregateId,
      state,
      version,
      timestamp: new Date().toISOString()
    };

    const snapshotFile = path.join(SNAPSHOTS_DIR, `${aggregateId}.json`);
    await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2));
  }

  async getSnapshot(aggregateId) {
    if (!this.initialized) await this.initialize();

    const snapshotFile = path.join(SNAPSHOTS_DIR, `${aggregateId}.json`);
    try {
      const content = await fs.readFile(snapshotFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}

export default new EventStore();
