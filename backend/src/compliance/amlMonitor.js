import prisma from '../db/client.js';
import riskScorer from './riskScorer.js';
import complianceAudit from './complianceAudit.js';
import kycCollector from './kycCollector.js';
import logger from '../config/logger.js';
import redis from '../db/redis.js';
import {
  THRESHOLDS,
  PRE_SUBMISSION_RULES,
  POST_SUBMISSION_ONLY_RULES,
} from './rules.js';

const amlLogger = logger.child({ component: 'aml' });
const WINDOW_MS = THRESHOLDS.WINDOW_MS;

// Durable Dead Letter Queue for AML alerts that fail to persist to the database.
// BSA/AML regulations require complete, durable retention of all monitoring alerts.
const ALERT_DLQ_KEY = 'compliance:dlq:alerts';

// Post-submission rules for monitoring
const ALL_RULES = [
  ...PRE_SUBMISSION_RULES,
  ...POST_SUBMISSION_ONLY_RULES,
  {
    id: 'UNVERIFIED_USER',
    description: 'Transaction from unverified user',
    severity: 'MEDIUM',
    check: async (tx) => !(await kycCollector.isVerified(tx.senderId)),
  },
];

class AMLMonitor {
  // Synchronous pre-submission screening that can block payments
  async screenTransactionPreSubmission(tx, history = []) {
    const alerts = [];

    // Only check pre-submission rules
    for (const rule of PRE_SUBMISSION_RULES) {
      const triggered = await rule.check(tx, history);
      if (triggered) {
        alerts.push({ ruleId: rule.id, description: rule.description, severity: rule.severity });
      }
    }

    const riskScore = await riskScorer.scoreTransaction(tx, alerts);

    return {
      alerts,
      riskScore,
      flagged: alerts.length > 0,
      blocking: alerts.some(a => a.severity === 'HIGH'),
    };
  }

  // Asynchronous post-submission screening for monitoring
  async screenTransaction(tx, history = []) {
    const alerts = [];

    for (const rule of ALL_RULES) {
      const triggered = await rule.check(tx, history);
      if (triggered) {
        alerts.push({ ruleId: rule.id, description: rule.description, severity: rule.severity });
      }
    }

    const riskScore = await riskScorer.scoreTransaction(tx, alerts);

    if (alerts.length > 0) {
      // Persist each alert to DB (requires a real transactionId)
      if (tx.id && tx.senderId) {
        await Promise.all(alerts.map(alert =>
          prisma.aMLAlert.create({
            data: {
              transactionId: tx.id,
              userId:        tx.senderId,
              ruleId:        alert.ruleId,
              severity:      alert.severity,
              description:   alert.description,
              riskScore:     riskScore.score ?? 0,
              riskLevel:     riskScore.level ?? 'UNKNOWN',
            },
          }).catch(err => this._handleAlertPersistenceFailure(err, alert, tx, riskScore))
        ));
      }

      await complianceAudit.log('AML_ALERT', tx.senderId, {
        transactionId: tx.id,
        alerts,
        riskScore,
      });
    }

    return { alerts, riskScore, flagged: alerts.length > 0 };
  }

  // Handle a failed alert persistence: log, emit metric, and durably enqueue to the DLQ.
  // Never silently drop an AML alert — BSA/AML requires durable retention.
  async _handleAlertPersistenceFailure(err, alert, tx, riskScore) {
    amlLogger.error(
      { err, alert, txId: tx.id, ruleId: alert.ruleId },
      'compliance.aml_alert.persist_failed'
    );

    if (typeof amlLogger.increment === 'function') {
      amlLogger.increment('aml_alert_persistence_failures_total');
    }

    const record = {
      transactionId: tx.id,
      userId:        tx.senderId,
      ruleId:        alert.ruleId,
      severity:      alert.severity,
      description:   alert.description,
      riskScore:     riskScore.score ?? 0,
      riskLevel:     riskScore.level ?? 'UNKNOWN',
      failedAt:      new Date().toISOString(),
      reason:        err?.message ?? String(err),
    };

    try {
      await redis.rpush(ALERT_DLQ_KEY, JSON.stringify(record));
    } catch (dlqError) {
      amlLogger.error(
        { err: dlqError, record },
        'compliance.aml_alert.dlq_write_failed'
      );
    }
  }

  // Set account hold for review
  async holdAccountForReview(userId, reason) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          amlStatus: 'HELD_FOR_REVIEW',
          amlHoldReason: reason,
          amlHoldDate: new Date(),
        },
      });

      amlLogger.warn('Account held for AML review', {
        userId,
        reason,
      });

      await complianceAudit.log('ACCOUNT_HOLD', userId, {
        reason,
        status: 'HELD_FOR_REVIEW',
      });

      // Enforce the hold on-chain: freeze trustlines, cancel DEX offers, halt streams.
      const enforcement = await this._enforceOnChainHold(userId, reason);

      await complianceAudit.log('ACCOUNT_HOLD_ONCHAIN_ENFORCED', userId, {
        reason,
        enforcement,
      });

      return enforcement;
    } catch (error) {
      amlLogger.error('Failed to hold account for review', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  // Enforce an AML hold on-chain for every active Stellar account owned by the user.
  // Best-effort per account: a failure on one account is logged and recorded but does
  // not prevent enforcement on the others or the DB-level hold from taking effect.
  async _enforceOnChainHold(userId, reason) {
    const results = [];

    let accounts = [];
    try {
      accounts = await prisma.stellarAccount.findMany({
        where: { userId, isActive: true },
        select: { id: true, publicKey: true },
      });
    } catch (error) {
      amlLogger.error('Failed to load Stellar accounts for hold enforcement', {
        userId,
        error: error.message,
      });
      return { accounts: [], results: [], error: error.message };
    }

    for (const account of accounts) {
      const result = { publicKey: account.publicKey };

      try {
        result.cancelledOffers = await this._cancelOpenDexOffers(account.publicKey);
      } catch (error) {
        result.cancelledOffersError = error.message;
        amlLogger.error('Failed to cancel open DEX offers during hold', {
          userId,
          publicKey: account.publicKey,
          error: error.message,
        });
      }

      try {
        result.frozenTrustlines = await this._freezeRevocableTrustlines(account.publicKey);
      } catch (error) {
        result.frozenTrustlinesError = error.message;
        amlLogger.error('Failed to freeze trustlines during hold', {
          userId,
          publicKey: account.publicKey,
          error: error.message,
        });
      }

      try {
        result.cancelledStreams = await this._cancelAccountStreams(userId, account.publicKey);
      } catch (error) {
        result.cancelledStreamsError = error.message;
        amlLogger.error('Failed to cancel payment streams during hold', {
          userId,
          publicKey: account.publicKey,
          error: error.message,
        });
      }

      results.push(result);
    }

    return { accounts: accounts.map(a => a.publicKey), results };
  }

  // Cancel every open DEX offer placed by the account via manageSellOffer(amount: '0').
  async _cancelOpenDexOffers(publicKey) {
    const { Horizon, Operation, TransactionBuilder, Networks, Keypair } = await import('@stellar/stellar-sdk');
    const server = new Horizon.Server(process.env.HORIZON_URL || 'https://horizon.stellar.org');

    const offers = await server.offers().forAccount(publicKey).limit(200).call();
    const records = offers.records || [];
    if (records.length === 0) return 0;

    const sourceKeypair = Keypair.fromSecret(process.env.PLATFORM_SIGNING_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    const builder = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.PUBLIC,
    });

    for (const offer of records) {
      builder.addOperation(Operation.manageSellOffer({
        selling: offer.selling,
        buying: offer.buying,
        amount: '0',
        price: offer.price,
        offerId: offer.id,
      }));
    }

    const tx = builder.setTimeout(180).build();
    tx.sign(sourceKeypair);
    await server.submitTransaction(tx);

    return records.length;
  }

  // Freeze platform-issued assets held by the account when the issuer is AUTH_REVOCABLE.
  async _freezeRevocableTrustlines(publicKey) {
    const { Horizon, Operation, Asset, TransactionBuilder, Networks, Keypair } = await import('@stellar/stellar-sdk');
    const server = new Horizon.Server(process.env.HORIZON_URL || 'https://horizon.stellar.org');

    const account = await server.accounts().accountId(publicKey).call();
    const balances = account.balances || [];

    const platformIssuer = process.env.PLATFORM_ISSUER_PUBLIC_KEY;
    if (!platformIssuer) return 0;

    const revocable = balances.filter(b =>
      b.asset_type !== 'native' &&
      b.asset_issuer === platformIssuer &&
      b.is_authorized !== false
    );
    if (revocable.length === 0) return 0;

    const sourceKeypair = Keypair.fromSecret(process.env.PLATFORM_SIGNING_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    const builder = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.PUBLIC,
    });

    for (const balance of revocable) {
      builder.addOperation(Operation.setTrustLineFlags({
        trustor: publicKey,
        asset: new Asset(balance.asset_code, balance.asset_issuer),
        flags: { authorized: false },
      }));
    }

    const tx = builder.setTimeout(180).build();
    tx.sign(sourceKeypair);
    await server.submitTransaction(tx);

    return revocable.length;
  }

  // Halt active payment streams originating from the held account.
  async _cancelAccountStreams(userId, publicKey) {
    const { default: streamingService } = await import('../services/streaming.js');
    if (!streamingService || typeof streamingService.cancelStream !== 'function') return 0;

    const streams = await prisma.paymentStream.findMany({
      where: {
        OR: [
          { senderId: userId },
          { sourcePublicKey: publicKey },
        ],
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    let cancelled = 0;
    for (const stream of streams) {
      await streamingService.cancelStream(stream.id, 'AML_HOLD');
      cancelled += 1;
    }

    return cancelled;
  }

  // Clear account hold
  async clearAccountHold(userId) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          amlStatus: 'CLEAR',
          amlHoldReason: null,
          amlHoldDate: null,
        },
      });

      amlLogger.info('Account hold cleared', { userId });

      await complianceAudit.log('ACCOUNT_HOLD_CLEARED', userId, {
        status: 'CLEAR',
      });
    } catch (error) {
      amlLogger.error('Failed to clear account hold', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  // Get transaction history with locking
  async getTransactionHistory(userId, windowMs = WINDOW_MS) {
    const windowStart = new Date(Date.now() - windowMs);

    try {
      return await prisma.transaction.findMany({
        where: {
          senderId: userId,
          createdAt: {
            gte: windowStart,
          },
          successful: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error) {
      amlLogger.error('Failed to retrieve transaction history', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }
}

export default new AMLMonitor();
