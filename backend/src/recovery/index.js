export { generateRecoveryPhrase, validatePhraseFormat } from './recoveryPhrase.js';
export { addContact, confirmContact, removeContact, getContacts, getConfirmedContactCount } from './contactManager.js';
export {
  initiateRecovery, recordAttempt, addApproval, completeRecovery,
  cancelRecovery, getActiveRequest, getRequest, getUserRequests,
} from './recoveryWorkflow.js';
export {
  setupRecoveryPhrase, verifyRecoveryPhrase, markPhraseUsed,
  hasRecoveryPhrase, stageNewCredentials, consumePendingCredentials,
} from './recoveryStore.js';
export * from './recoveryAudit.js';
