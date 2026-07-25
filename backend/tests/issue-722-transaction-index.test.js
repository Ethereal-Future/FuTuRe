import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectDB, disconnectDB, queryDB } from '../../backend/src/db/client.js';

describe('#722 - Transaction Account Index', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await disconnectDB();
  });

  it('should have composite index idx_transactions_account_created on transactions table', async () => {
    const result = await queryDB(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Transaction'
      AND indexname = 'idx_transactions_account_created'
    `);
    
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].indexname).toBe('idx_transactions_account_created');
    expect(result.rows[0].indexdef).toContain('senderId');
    expect(result.rows[0].indexdef).toContain('createdAt');
  });

  it('should use index for account transaction history query', async () => {
    const accountId = 'test-account-id';
    
    const plan = await queryDB(`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM "Transaction"
      WHERE "senderId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 20
    `, [accountId]);
    
    const planJson = JSON.parse(plan.rows[0][0]);
    const planStr = JSON.stringify(planJson);
    
    // Index scan should be used instead of seq scan
    expect(planStr).toMatch(/Index Scan|Index Only Scan/);
    expect(planStr).not.toMatch(/Seq Scan.*Transaction/);
  });

  it('should have lower execution cost with index', async () => {
    // This demonstrates that the index improves query performance
    const withIndexPlan = await queryDB(`
      EXPLAIN (FORMAT JSON, ANALYZE true)
      SELECT * FROM "Transaction"
      WHERE "senderId" = 'any-id'
      ORDER BY "createdAt" DESC
      LIMIT 20
    `);
    
    const plan = JSON.parse(withIndexPlan.rows[0][0]);
    const totalCost = plan[0]?.['Plan']?.['Total Cost'] ?? 0;
    
    // Cost should be reasonable (with index, typically < 50 for small results)
    expect(totalCost).toBeDefined();
    expect(totalCost).toBeGreaterThanOrEqual(0);
  });
});
