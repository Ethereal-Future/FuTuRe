/**
 * Test Data Management
 * 
 * Utilities for managing test data, fixtures, and test environment isolation
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'test-data');
const FIXTURES_DIR = path.join(__dirname, '..', 'test-fixtures');

/**
 * Test Data Manager
 * Handles creation, seeding, and cleanup of test data
 */
export class TestDataManager {
  constructor() {
    this.dataDir = DATA_DIR;
    this.fixturesDir = FIXTURES_DIR;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.fixturesDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Generate test account data
   */
  async generateTestAccounts(count = 10) {
    await this.initialize();

    const accounts = [];
    for (let i = 0; i < count; i++) {
      accounts.push({
        id: `test-account-${i}`,
        publicKey: this.generateStellarPublicKey(),
        secretKey: this.generateStellarSecretKey(),
        balance: (Math.random() * 10000).toFixed(7),
        createdAt: new Date().toISOString(),
        metadata: {
          testAccount: true,
          index: i,
        },
      });
    }

    const filePath = path.join(this.dataDir, 'test-accounts.json');
    await fs.writeFile(filePath, JSON.stringify(accounts, null, 2));

    return accounts;
  }

  /**
   * Generate test transaction data
   */
  async generateTestTransactions(accountId, count = 50) {
    await this.initialize();

    const transactions = [];
    const types = ['payment', 'create_account', 'change_trust', 'payment'];
    const assets = ['XLM', 'USDC', 'EURT', 'BTC'];

    for (let i = 0; i < count; i++) {
      const type = types[Math.floor(Math.random() * types.length)];
      const asset = assets[Math.floor(Math.random() * assets.length)];
      
      transactions.push({
        id: `tx-${accountId}-${i}`,
        hash: this.generateTransactionHash(),
        type,
        asset,
        amount: (Math.random() * 1000).toFixed(7),
        from: this.generateStellarPublicKey(),
        to: this.generateStellarPublicKey(),
        status: Math.random() > 0.1 ? 'success' : 'failed',
        ledger: Math.floor(Math.random() * 1000000),
        timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        fee: (Math.random() * 0.1).toFixed(7),
        metadata: {
          testTransaction: true,
          accountId,
          index: i,
        },
      });
    }

    const filePath = path.join(this.dataDir, `transactions-${accountId}.json`);
    await fs.writeFile(filePath, JSON.stringify(transactions, null, 2));

    return transactions;
  }

  /**
   * Seed database with test data
   */
  async seedDatabase(prismaClient) {
    await this.initialize();

    console.log('Seeding database with test data...');

    // Create test users
    const users = [];
    for (let i = 0; i < 5; i++) {
      const user = await prismaClient.user.upsert({
        where: { publicKey: `TEST_USER_${i}` },
        update: {},
        create: {
          publicKey: `TEST_USER_${i}`,
          email: `testuser${i}@example.com`,
          name: `Test User ${i}`,
        },
      });
      users.push(user);
    }

    // Create test transactions
    for (const user of users) {
      for (let i = 0; i < 10; i++) {
        await prismaClient.transaction.create({
          data: {
            hash: this.generateTransactionHash(),
            assetCode: 'XLM',
            amount: (Math.random() * 1000).toFixed(7),
            ledger: Math.floor(Math.random() * 1000000),
            successful: Math.random() > 0.1,
            senderId: user.id,
            recipientId: users[Math.floor(Math.random() * users.length)].id,
          },
        });
      }
    }

    console.log(`Seeded ${users.length} users with transactions`);
    return users;
  }

  /**
   * Clean up test data
   */
  async cleanupTestData(prismaClient) {
    console.log('Cleaning up test data...');

    try {
      // Delete test transactions
      await prismaClient.transaction.deleteMany({
        where: {
          sender: {
            publicKey: { startsWith: 'TEST_USER_' },
          },
        },
      });

      // Delete test users
      await prismaClient.user.deleteMany({
        where: {
          publicKey: { startsWith: 'TEST_USER_' },
        },
      });

      console.log('Test data cleaned up successfully');
    } catch (error) {
      console.error('Error cleaning up test data:', error);
    }
  }

  /**
   * Clean up test files
   */
  async cleanupTestFiles() {
    await this.initialize();

    try {
      const files = await fs.readdir(this.dataDir);
      for (const file of files) {
        if (file.startsWith('test-') || file.startsWith('transactions-')) {
          await fs.unlink(path.join(this.dataDir, file));
        }
      }
      console.log('Test files cleaned up successfully');
    } catch (error) {
      console.error('Error cleaning up test files:', error);
    }
  }

  /**
   * Create test fixture
   */
  async createFixture(name, data) {
    await this.initialize();

    const fixturePath = path.join(this.fixturesDir, `${name}.json`);
    await fs.writeFile(fixturePath, JSON.stringify(data, null, 2));
    return fixturePath;
  }

  /**
   * Load test fixture
   */
  async loadFixture(name) {
    await this.initialize();

    const fixturePath = path.join(this.fixturesDir, `${name}.json`);
    const data = await fs.readFile(fixturePath, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * List all fixtures
   */
  async listFixtures() {
    await this.initialize();

    const files = await fs.readdir(this.fixturesDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  /**
   * Delete fixture
   */
  async deleteFixture(name) {
    await this.initialize();

    const fixturePath = path.join(this.fixturesDir, `${name}.json`);
    await fs.unlink(fixturePath);
  }

  /**
   * Generate Stellar public key (mock)
   */
  generateStellarPublicKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let key = 'G';
    for (let i = 0; i < 55; i++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    return key;
  }

  /**
   * Generate Stellar secret key (mock)
   */
  generateStellarSecretKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let key = 'S';
    for (let i = 0; i < 55; i++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    return key;
  }

  /**
   * Generate transaction hash (mock)
   */
  generateTransactionHash() {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  /**
   * Create test environment snapshot
   */
  async createSnapshot(name) {
    await this.initialize();

    const snapshotDir = path.join(this.dataDir, 'snapshots', name);
    await fs.mkdir(snapshotDir, { recursive: true });

    // Copy current test data
    const files = await fs.readdir(this.dataDir);
    for (const file of files) {
      if (file !== 'snapshots') {
        const srcPath = path.join(this.dataDir, file);
        const destPath = path.join(snapshotDir, file);
        await fs.copyFile(srcPath, destPath);
      }
    }

    console.log(`Snapshot created: ${name}`);
    return snapshotDir;
  }

  /**
   * Restore test environment snapshot
   */
  async restoreSnapshot(name) {
    await this.initialize();

    const snapshotDir = path.join(this.dataDir, 'snapshots', name);
    
    // Check if snapshot exists
    try {
      await fs.access(snapshotDir);
    } catch {
      throw new Error(`Snapshot not found: ${name}`);
    }

    // Restore files
    const files = await fs.readdir(snapshotDir);
    for (const file of files) {
      const srcPath = path.join(snapshotDir, file);
      const destPath = path.join(this.dataDir, file);
      await fs.copyFile(srcPath, destPath);
    }

    console.log(`Snapshot restored: ${name}`);
  }

  /**
   * List all snapshots
   */
  async listSnapshots() {
    await this.initialize();

    const snapshotsDir = path.join(this.dataDir, 'snapshots');
    try {
      const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Delete snapshot
   */
  async deleteSnapshot(name) {
    await this.initialize();

    const snapshotDir = path.join(this.dataDir, 'snapshots', name);
    await fs.rm(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * Test Data Factory
 * Creates test data with customizable overrides
 */
export class TestDataFactory {
  constructor() {
    this.dataManager = new TestDataManager();
  }

  /**
   * Create account with overrides
   */
  async createAccount(overrides = {}) {
    const defaultAccount = {
      publicKey: this.dataManager.generateStellarPublicKey(),
      secretKey: this.dataManager.generateStellarSecretKey(),
      balance: '10000.0000000',
      email: 'test@example.com',
      name: 'Test User',
    };

    return { ...defaultAccount, ...overrides };
  }

  /**
   * Create transaction with overrides
   */
  async createTransaction(overrides = {}) {
    const defaultTransaction = {
      hash: this.dataManager.generateTransactionHash(),
      type: 'payment',
      asset: 'XLM',
      amount: '100.0000000',
      from: this.dataManager.generateStellarPublicKey(),
      to: this.dataManager.generateStellarPublicKey(),
      status: 'success',
      ledger: 12345,
      timestamp: new Date().toISOString(),
      fee: '0.0000100',
    };

    return { ...defaultTransaction, ...overrides };
  }

  /**
   * Create multiple transactions
   */
  async createTransactions(count, overrides = {}) {
    const transactions = [];
    for (let i = 0; i < count; i++) {
      transactions.push(await this.createTransaction({ ...overrides, index: i }));
    }
    return transactions;
  }

  /**
   * Create payment request with overrides
   */
  async createPaymentRequest(overrides = {}) {
    const defaultRequest = {
      sourceSecret: this.dataManager.generateStellarSecretKey(),
      destination: this.dataManager.generateStellarPublicKey(),
      amount: '10.0000000',
      assetCode: 'XLM',
    };

    return { ...defaultRequest, ...overrides };
  }

  /**
   * Create error response with overrides
   */
  async createErrorResponse(overrides = {}) {
    const defaultError = {
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      code: 500,
    };

    return { ...defaultError, ...overrides };
  }
}

// Export singleton instances
export const testDataManager = new TestDataManager();
export const testDataFactory = new TestDataFactory();
