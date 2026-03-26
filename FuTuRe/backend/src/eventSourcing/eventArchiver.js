import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_DIR = path.join(__dirname, '../../data/archive');
const EVENTS_DIR = path.join(__dirname, '../../data/events');

class EventArchiver {
  async initialize() {
    await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  }

  async archiveOldEvents(olderThanDays = 30) {
    await this.initialize();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    try {
      const files = await fs.readdir(EVENTS_DIR);
      const archivedCount = { events: 0, aggregates: 0 };

      for (const file of files) {
        const eventFile = path.join(EVENTS_DIR, file);
        const content = await fs.readFile(eventFile, 'utf-8');
        const events = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));

        const oldEvents = events.filter(e => new Date(e.timestamp) < cutoffDate);
        const recentEvents = events.filter(e => new Date(e.timestamp) >= cutoffDate);

        if (oldEvents.length > 0) {
          const archiveFile = path.join(ARCHIVE_DIR, `${file}.${Date.now()}.archive`);
          await fs.writeFile(archiveFile, oldEvents.map(e => JSON.stringify(e)).join('\n'));
          archivedCount.events += oldEvents.length;
          archivedCount.aggregates++;

          // Keep only recent events
          if (recentEvents.length > 0) {
            await fs.writeFile(eventFile, recentEvents.map(e => JSON.stringify(e) + '\n').join(''));
          } else {
            await fs.unlink(eventFile);
          }
        }
      }

      return archivedCount;
    } catch (error) {
      console.error('Archive failed:', error);
      throw error;
    }
  }

  async getArchivedEvents(aggregateId) {
    await this.initialize();

    try {
      const files = await fs.readdir(ARCHIVE_DIR);
      const aggregateArchives = files.filter(f => f.startsWith(aggregateId));
      const allEvents = [];

      for (const file of aggregateArchives) {
        const content = await fs.readFile(path.join(ARCHIVE_DIR, file), 'utf-8');
        const events = content
          .split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
        allEvents.push(...events);
      }

      return allEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch (error) {
      console.error('Failed to get archived events:', error);
      return [];
    }
  }

  async restoreFromArchive(aggregateId, toDate) {
    const archivedEvents = await this.getArchivedEvents(aggregateId);
    return archivedEvents.filter(e => new Date(e.timestamp) <= new Date(toDate));
  }
}

export default new EventArchiver();
