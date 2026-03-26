/**
 * Example: Using Test Data Factories
 * Demonstrates how to use factories for consistent test data
 */

import { describe, it, expect } from 'vitest';
import { stellarAccountFactory, transactionFactory } from '../../testing/factories.js';

describe('Test Data Factories', () => {
  it('should create a single stellar account', () => {
    const account = stellarAccountFactory.create();
    expect(account).toHaveProperty('publicKey');
    expect(account).toHaveProperty('secretKey');
    expect(account).toHaveProperty('balance');
  });

  it('should create multiple stellar accounts', () => {
    const accounts = stellarAccountFactory.createMany(5);
    expect(accounts).toHaveLength(5);
    expect(accounts[0].publicKey).not.toBe(accounts[1].publicKey);
  });

  it('should override factory defaults', () => {
    const account = stellarAccountFactory.create({ balance: '5000.0000000' });
    expect(account.balance).toBe('5000.0000000');
  });

  it('should create transactions with factory', () => {
    const transaction = transactionFactory.create();
    expect(transaction).toHaveProperty('from');
    expect(transaction).toHaveProperty('to');
    expect(transaction).toHaveProperty('amount');
    expect(transaction.status).toBe('success');
  });

  it('should create multiple transactions', () => {
    const transactions = transactionFactory.createMany(3);
    expect(transactions).toHaveLength(3);
    transactions.forEach((tx) => {
      expect(tx).toHaveProperty('id');
      expect(tx).toHaveProperty('timestamp');
    });
  });
});
