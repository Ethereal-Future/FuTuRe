/**
 * Test Data Seeding Script
 * 
 * Seeds the database with test data for development and testing
 */

import { PrismaClient } from '@prisma/client';
import { testDataManager, testDataFactory } from './data-management.js';

const prisma = new PrismaClient();

async function seedDatabase() {
  console.log('Starting database seeding...');
  console.log('='.repeat(60));

  try {
    // Initialize test data manager
    await testDataManager.initialize();

    // Generate test accounts
    console.log('Generating test accounts...');
    const accounts = await testDataManager.generateTestAccounts(10);
    console.log(`Generated ${accounts.length} test accounts`);

    // Seed database with users
    console.log('Seeding database with users...');
    const users = await testDataManager.seedDatabase(prisma);
    console.log(`Seeded ${users.length} users`);

    // Generate test transactions for each user
    console.log('Generating test transactions...');
    for (const user of users) {
      const transactions = await testDataManager.generateTestTransactions(user.publicKey, 20);
      console.log(`Generated ${transactions.length} transactions for ${user.publicKey}`);
    }

    // Create fixtures
    console.log('Creating test fixtures...');
    
    // Account fixture
    const accountFixture = await testDataFactory.createAccount({
      publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
      name: 'Fixture Account',
    });
    await testDataManager.createFixture('account', accountFixture);

    // Transaction fixture
    const transactionFixture = await testDataFactory.createTransaction({
      hash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2',
      amount: '100.0000000',
    });
    await testDataManager.createFixture('transaction', transactionFixture);

    // Payment request fixture
    const paymentFixture = await testDataFactory.createPaymentRequest({
      amount: '50.0000000',
      assetCode: 'USDC',
    });
    await testDataManager.createFixture('payment', paymentFixture);

    // Multiple transactions fixture
    const transactionsFixture = await testDataFactory.createTransactions(10, {
      type: 'payment',
      asset: 'XLM',
    });
    await testDataManager.createFixture('transactions', transactionsFixture);

    console.log('Created test fixtures');

    // Create snapshot
    console.log('Creating initial snapshot...');
    await testDataManager.createSnapshot('initial');
    console.log('Created initial snapshot');

    console.log('='.repeat(60));
    console.log('Database seeding completed successfully!');
    console.log('');
    console.log('Summary:');
    console.log(`  - ${accounts.length} test accounts generated`);
    console.log(`  - ${users.length} users seeded in database`);
    console.log(`  - ${users.length * 20} transactions generated`);
    console.log(`  - 4 test fixtures created`);
    console.log(`  - 1 snapshot created`);
    console.log('');
    console.log('Test data is ready for use!');

  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function clearDatabase() {
  console.log('Clearing test data from database...');
  console.log('='.repeat(60));

  try {
    await testDataManager.cleanupTestData(prisma);
    await testDataManager.cleanupTestFiles();
    
    console.log('='.repeat(60));
    console.log('Database cleared successfully!');

  } catch (error) {
    console.error('Error clearing database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function resetDatabase() {
  console.log('Resetting database...');
  console.log('='.repeat(60));

  try {
    // Clear existing data
    await clearDatabase();
    
    // Re-seed
    await seedDatabase();
    
    console.log('='.repeat(60));
    console.log('Database reset completed successfully!');

  } catch (error) {
    console.error('Error resetting database:', error);
    throw error;
  }
}

async function showStatus() {
  console.log('Test Data Status');
  console.log('='.repeat(60));

  try {
    await testDataManager.initialize();

    // List fixtures
    const fixtures = await testDataManager.listFixtures();
    console.log(`Fixtures: ${fixtures.length}`);
    fixtures.forEach(f => console.log(`  - ${f}`));

    // List snapshots
    const snapshots = await testDataManager.listSnapshots();
    console.log(`\nSnapshots: ${snapshots.length}`);
    snapshots.forEach(s => console.log(`  - ${s}`));

    // Count database records
    const userCount = await prisma.user.count();
    const transactionCount = await prisma.transaction.count();
    console.log(`\nDatabase Records:`);
    console.log(`  - Users: ${userCount}`);
    console.log(`  - Transactions: ${transactionCount}`);

  } catch (error) {
    console.error('Error getting status:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// CLI interface
const command = process.argv[2];

async function main() {
  switch (command) {
    case 'seed':
      await seedDatabase();
      break;
    case 'clear':
      await clearDatabase();
      break;
    case 'reset':
      await resetDatabase();
      break;
    case 'status':
      await showStatus();
      break;
    default:
      console.log('Usage: node seed-data.js [seed|clear|reset|status]');
      console.log('');
      console.log('Commands:');
      console.log('  seed   - Seed database with test data');
      console.log('  clear  - Clear all test data from database');
      console.log('  reset  - Clear and re-seed database');
      console.log('  status - Show test data status');
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
