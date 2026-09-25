import logger from '../config/logger.js';
import prisma from '../db/client.js';

const incidentLogger = logger.child({ component: 'incident-response' });

class IncidentResponse {
  constructor() {
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

  /**
   * Create a new security incident
   * Persists to database, replacing in-memory Map and JSON files (fixes #966)
   */
  async createIncident(type, severity, description, affectedSystems = []) {
    const incidentId = `INC-${Date.now()}`;
    const playbook = this.responsePlaybooks.get(type);

    const incident = await prisma.securityIncident.create({
      data: {
        incidentId,
        type,
        severity,
        description,
        affectedSystems,
        playbook: playbook?.actions || [],
        status: 'OPEN'
      },
      include: {
        actions: true,
        notes: true
      }
    });

    return this._formatIncident(incident);
  }

  /**
   * Update an existing incident
   * Reads from and writes to database (fixes #966)
   */
  async updateIncident(incidentId, updates) {
    const incident = await prisma.securityIncident.findUnique({
      where: { incidentId },
      include: {
        actions: true,
        notes: true
      }
    });

    if (!incident) {
      throw new Error('Incident not found');
    }

    const updated = await prisma.securityIncident.update({
      where: { incidentId },
      data: {
        ...updates,
        updatedAt: new Date()
      },
      include: {
        actions: true,
        notes: true
      }
    });

    return this._formatIncident(updated);
  }

  /**
   * Mark an action as complete for an incident
   */
  async completeAction(incidentId, action) {
    const incident = await prisma.securityIncident.findUnique({
      where: { incidentId },
      include: {
        actions: true
      }
    });

    if (!incident) {
      throw new Error('Incident not found');
    }

    // Check if action already completed
    const existingAction = incident.actions.find(a => a.action === action);
    if (!existingAction) {
      await prisma.incidentAction.create({
        data: {
          incidentId: incident.id,
          action
        }
      });
    }

    // Check if all playbook actions are completed
    const completedActions = await prisma.incidentAction.findMany({
      where: { incidentId: incident.id }
    });

    const allActionsCompleted = incident.playbook.length > 0 && 
      completedActions.length === incident.playbook.length;

    if (allActionsCompleted && incident.status === 'OPEN') {
      await prisma.securityIncident.update({
        where: { incidentId },
        data: { status: 'RESOLVED' }
      });
    }

    return this.getIncident(incidentId);
  }

  /**
   * Add a note to an incident
   */
  async addNote(incidentId, content) {
    const incident = await prisma.securityIncident.findUnique({
      where: { incidentId }
    });

    if (!incident) {
      throw new Error('Incident not found');
    }

    await prisma.incidentNote.create({
      data: {
        incidentId: incident.id,
        content
      }
    });

    return this.getIncident(incidentId);
  }

  /**
   * Get a specific incident by ID
   * Reads from database (fixes #966)
   */
  async getIncident(incidentId) {
    const incident = await prisma.securityIncident.findUnique({
      where: { incidentId },
      include: {
        actions: true,
        notes: true
      }
    });

    if (!incident) {
      return null;
    }

    return this._formatIncident(incident);
  }

  /**
   * Get all open incidents
   * Reads from database (fixes #966)
   */
  async getOpenIncidents() {
    try {
      const incidents = await prisma.securityIncident.findMany({
        where: { status: 'OPEN' },
        include: {
          actions: true,
          notes: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return incidents.map(incident => this._formatIncident(incident));
    } catch (error) {
      incidentLogger.error('Failed to get incidents', { error: error.message });
      return [];
    }
  }

  /**
   * Get incidents by status
   */
  async getIncidentsByStatus(status) {
    const incidents = await prisma.securityIncident.findMany({
      where: { status },
      include: {
        actions: true,
        notes: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return incidents.map(incident => this._formatIncident(incident));
  }

  /**
   * Format incident for backward compatibility with previous API
   */
  _formatIncident(incident) {
    return {
      id: incident.incidentId,
      type: incident.type,
      severity: incident.severity,
      description: incident.description,
      affectedSystems: incident.affectedSystems,
      status: incident.status,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
      playbook: incident.playbook,
      completedActions: incident.actions?.map(a => a.action) || [],
      notes: incident.notes?.map(n => ({
        timestamp: n.timestamp.toISOString(),
        content: n.content
      })) || []
    };
  }
}

export default new IncidentResponse();
