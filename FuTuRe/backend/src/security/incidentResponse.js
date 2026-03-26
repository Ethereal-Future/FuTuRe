import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INCIDENT_DIR = path.join(__dirname, '../../data/incidents');

class IncidentResponse {
  constructor() {
    this.incidents = new Map();
    this.responsePlaybooks = new Map();
    this.setupDefaultPlaybooks();
  }

  setupDefaultPlaybooks() {
    this.responsePlaybooks.set('UNAUTHORIZED_ACCESS', {
      severity: 'CRITICAL',
      actions: [
        'Block user account',
        'Revoke all active sessions',
        'Notify user',
        'Log security event',
        'Alert security team'
      ]
    });

    this.responsePlaybooks.set('DATA_BREACH', {
      severity: 'CRITICAL',
      actions: [
        'Isolate affected systems',
        'Preserve evidence',
        'Notify affected users',
        'Contact authorities',
        'Initiate forensics'
      ]
    });

    this.responsePlaybooks.set('MALWARE_DETECTED', {
      severity: 'CRITICAL',
      actions: [
        'Quarantine affected systems',
        'Scan all systems',
        'Update security definitions',
        'Review logs',
        'Restore from clean backup'
      ]
    });

    this.responsePlaybooks.set('DDoS_ATTACK', {
      severity: 'HIGH',
      actions: [
        'Enable rate limiting',
        'Activate DDoS protection',
        'Redirect traffic',
        'Monitor metrics',
        'Notify ISP'
      ]
    });
  }

  async initialize() {
    await fs.mkdir(INCIDENT_DIR, { recursive: true });
  }

  async createIncident(type, severity, description, affectedSystems = []) {
    await this.initialize();

    const incidentId = `INC-${Date.now()}`;
    const playbook = this.responsePlaybooks.get(type);

    const incident = {
      id: incidentId,
      type,
      severity,
      description,
      affectedSystems,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      playbook: playbook?.actions || [],
      completedActions: [],
      notes: []
    };

    this.incidents.set(incidentId, incident);

    const incidentFile = path.join(INCIDENT_DIR, `${incidentId}.json`);
    await fs.writeFile(incidentFile, JSON.stringify(incident, null, 2));

    return incident;
  }

  async updateIncident(incidentId, updates) {
    await this.initialize();

    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error('Incident not found');
    }

    Object.assign(incident, updates, { updatedAt: new Date().toISOString() });
    this.incidents.set(incidentId, incident);

    const incidentFile = path.join(INCIDENT_DIR, `${incidentId}.json`);
    await fs.writeFile(incidentFile, JSON.stringify(incident, null, 2));

    return incident;
  }

  async completeAction(incidentId, action) {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error('Incident not found');
    }

    if (!incident.completedActions.includes(action)) {
      incident.completedActions.push(action);
    }

    if (incident.completedActions.length === incident.playbook.length) {
      incident.status = 'RESOLVED';
    }

    return this.updateIncident(incidentId, { completedActions: incident.completedActions, status: incident.status });
  }

  async addNote(incidentId, note) {
    const incident = this.incidents.get(incidentId);
    if (!incident) {
      throw new Error('Incident not found');
    }

    incident.notes.push({
      timestamp: new Date().toISOString(),
      content: note
    });

    return this.updateIncident(incidentId, { notes: incident.notes });
  }

  async getIncident(incidentId) {
    const incidentFile = path.join(INCIDENT_DIR, `${incidentId}.json`);
    try {
      const content = await fs.readFile(incidentFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async getOpenIncidents() {
    await this.initialize();

    try {
      const files = await fs.readdir(INCIDENT_DIR);
      const incidents = [];

      for (const file of files) {
        const content = await fs.readFile(path.join(INCIDENT_DIR, file), 'utf-8');
        const incident = JSON.parse(content);
        if (incident.status === 'OPEN') {
          incidents.push(incident);
        }
      }

      return incidents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      console.error('Failed to get incidents:', error);
      return [];
    }
  }
}

export default new IncidentResponse();
