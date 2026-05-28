import crypto from 'crypto';

// In-memory store (replace with DB in production)
const recoveryRequests = new Map(); // requestId -> request
const userRequests = new Map();     // userId -> [requestId]

const DELAY_HOURS = 24; // mandatory time-lock before recovery completes
const MAX_ATTEMPTS = 5;
const EXPIRY_HOURS = 72;

export function initiateRecovery(userId, method, ipAddress) {
  // Check for existing active request
  const existing = getActiveRequest(userId);
  if (existing) throw new Error('Recovery already in progress');

  const requestId = crypto.randomUUID();
  const now = new Date();
  const request = {
    id: requestId,
    userId,
    method, // 'phrase' | 'social'
    status: 'pending', // pending -> approved -> completed | cancelled
    attempts: 0,
    ipAddress,
    initiatedAt: now.toISOString(),
    executeAfter: new Date(now.getTime() + DELAY_HOURS * 3600 * 1000).toISOString(),
    expiresAt: new Date(now.getTime() + EXPIRY_HOURS * 3600 * 1000).toISOString(),
    approvals: [],
    completedAt: null,
  };

  recoveryRequests.set(requestId, request);
  const userReqs = userRequests.get(userId) || [];
  userReqs.push(requestId);
  userRequests.set(userId, userReqs);

  return request;
}

export function recordAttempt(requestId, success) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'pending') throw new Error('Recovery request is not active');
  if (new Date() > new Date(request.expiresAt)) {
    request.status = 'expired';
    throw new Error('Recovery request has expired');
  }

  request.attempts += 1;

  if (!success && request.attempts >= MAX_ATTEMPTS) {
    request.status = 'locked';
    throw new Error('Too many failed attempts. Recovery locked.');
  }

  if (success) {
    request.status = 'approved';
  }

  return request;
}

export function addApproval(requestId, contactId) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'pending') throw new Error('Recovery request is not active');
  if (!request.approvals.includes(contactId)) {
    request.approvals.push(contactId);
  }
  return request;
}

export function completeRecovery(requestId) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'approved') throw new Error('Recovery not approved');
  if (new Date() < new Date(request.executeAfter)) {
    const remaining = Math.ceil((new Date(request.executeAfter) - new Date()) / 3600000);
    throw new Error(`Time-lock active. ${remaining}h remaining before recovery can complete.`);
  }

  request.status = 'completed';
  request.completedAt = new Date().toISOString();
  return request;
}

export function cancelRecovery(requestId, userId) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.userId !== userId) throw new Error('Unauthorized');
  if (['completed', 'cancelled'].includes(request.status)) {
    throw new Error('Cannot cancel a completed or already cancelled request');
  }
  request.status = 'cancelled';
  return request;
}

export function getActiveRequest(userId) {
  const ids = userRequests.get(userId) || [];
  for (const id of ids) {
    const req = recoveryRequests.get(id);
    if (req && ['pending', 'approved'].includes(req.status)) return req;
  }
  return null;
}

export function getRequest(requestId) {
  return recoveryRequests.get(requestId) || null;
}

export function getUserRequests(userId) {
  const ids = userRequests.get(userId) || [];
  return ids.map(id => recoveryRequests.get(id)).filter(Boolean);
}
