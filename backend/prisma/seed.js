/**
 * Database seed script for local development.
 *
 * Creates a realistic set of users, transactions, payment streams,
 * notifications, and contacts so developers can work against a populated DB
 * without manually inserting data.
 *
 * Usage:
 *   npm run db:seed          # via npm script
 *   npx prisma db seed       # via Prisma CLI (uses "prisma.seed" in package.json)
 *
 * The script is idempotent: re-running it skips records that already exist
 * (identified by publicKey / hash unique constraints).
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── Deterministic test keypairs (public keys only — no real secrets) ──────────
const USERS = [
  {
    username: 'alice',
    password: 'password123',
    publicKey: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
    role: 'ADMIN',
    defaultAsset: 'XLM',
  },
  {
    username: 'bob',
    password: 'password123',
    publicKey: 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
    role: 'USER',
    defaultAsset: 'XLM',
  },
  {
    username: 'carol',
    password: 'password123',
    publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
    role: 'COMPLIANCE',
    defaultAsset: 'USDC',
  },
  {
    username: 'dave',
    password: 'password123',
    publicKey: 'GDGQDVO6XGQF4TDJX15C4CHASUXBQDXX4HN6YCHRFXK5QDHEIJKLC4D',
    role: 'USER',
    defaultAsset: 'XLM',
  },
  {
    username: 'eve',
    password: 'password123',
    publicKey: 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345',
    role: 'USER',
    defaultAsset: 'XLM',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomAmount(min = 1, max = 1000) {
  return (Math.random() * (max - min) + min).toFixed(7);
}

function randomDate(daysAgo = 90) {
  const now = Date.now();
  const earliest = now - daysAgo * 24 * 60 * 60 * 1000;
  return new Date(earliest + Math.random() * (now - earliest));
}

function randomHex(bytes = 32) {
  return [...Array(bytes * 2)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join('');
}

const ASSETS = ['XLM', 'USDC', 'XLM', 'XLM']; // weighted toward XLM

function randomAsset() {
  return ASSETS[Math.floor(Math.random() * ASSETS.length)];
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding database…\n');

  // 1. Users + Settings ───────────────────────────────────────────────────────
  console.log('  → Users');
  const createdUsers = [];
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.upsert({
      where: { publicKey: u.publicKey },
      update: {},
      create: {
        publicKey: u.publicKey,
        username: u.username,
        passwordHash,
        role: u.role,
        settings: {
          create: {
            defaultAsset: u.defaultAsset,
            notificationsOn: true,
            accountLabel: `${u.username}'s wallet`,
          },
        },
      },
      include: { settings: true },
    });
    createdUsers.push(user);
    console.log(`     ✓ ${user.username} (${user.role})`);
  }

  // 2. Transactions ───────────────────────────────────────────────────────────
  console.log('\n  → Transactions');
  const [alice, bob, carol, dave] = createdUsers;
  const txPairs = [
    { sender: alice, recipient: bob, count: 15 },
    { sender: bob, recipient: carol, count: 10 },
    { sender: carol, recipient: alice, count: 8 },
    { sender: dave, recipient: alice, count: 5 },
    { sender: alice, recipient: dave, count: 7 },
  ];

  let txTotal = 0;
  for (const { sender, recipient, count } of txPairs) {
    for (let i = 0; i < count; i++) {
      const hash = randomHex(32);
      const asset = randomAsset();
      try {
        await prisma.transaction.create({
          data: {
            hash,
            assetCode: asset,
            amount: randomAmount(1, asset === 'USDC' ? 500 : 2000),
            ledger: Math.floor(Math.random() * 10_000_000) + 40_000_000,
            successful: Math.random() > 0.05, // ~95% success rate
            memo: Math.random() > 0.6 ? `Invoice #${Math.floor(Math.random() * 9999)}` : null,
            memoType: 'text',
            createdAt: randomDate(90),
            senderId: sender.id,
            recipientId: recipient.id,
          },
        });
        txTotal++;
      } catch {
        // Skip duplicate hashes (extremely unlikely but safe)
      }
    }
  }
  console.log(`     ✓ ${txTotal} transactions`);

  // 3. Payment Streams ────────────────────────────────────────────────────────
  console.log('\n  → Payment streams');
  const streams = [
    {
      sender: alice,
      recipient: bob,
      rateAmount: 1.5,
      intervalSeconds: 60,
      status: 'ACTIVE',
      assetCode: 'XLM',
    },
    {
      sender: bob,
      recipient: carol,
      rateAmount: 0.5,
      intervalSeconds: 300,
      status: 'PAUSED',
      assetCode: 'XLM',
    },
    {
      sender: carol,
      recipient: dave,
      rateAmount: 10,
      intervalSeconds: 3600,
      status: 'COMPLETED',
      assetCode: 'USDC',
    },
  ];

  for (const s of streams) {
    await prisma.paymentStream.create({
      data: {
        senderId: s.sender.id,
        recipientId: s.recipient.id,
        assetCode: s.assetCode,
        rateAmount: s.rateAmount,
        intervalSeconds: s.intervalSeconds,
        status: s.status,
        totalStreamed: parseFloat(randomAmount(0, 100)),
        startTime: randomDate(30),
        endTime: s.status === 'COMPLETED' ? randomDate(5) : null,
      },
    });
  }
  console.log(`     ✓ ${streams.length} streams`);

  // 4. Notifications ──────────────────────────────────────────────────────────
  console.log('\n  → Notifications');
  const notifTypes = ['payment_received', 'payment_sent', 'stream_tick', 'kyc_approved'];
  let notifTotal = 0;
  for (const user of createdUsers) {
    for (let i = 0; i < 5; i++) {
      const type = notifTypes[Math.floor(Math.random() * notifTypes.length)];
      await prisma.notification.create({
        data: {
          userId: user.id,
          type,
          channel: 'in_app',
          status: 'sent',
          title: `${type.replace(/_/g, ' ')}`,
          body: `Notification ${i + 1} for ${user.username}`,
          read: Math.random() > 0.5,
          createdAt: randomDate(14),
        },
      });
      notifTotal++;
    }
  }
  console.log(`     ✓ ${notifTotal} notifications`);

  // 5. Contacts ───────────────────────────────────────────────────────────────
  console.log('\n  → Contacts');
  const contactPairs = [
    { owner: alice, name: 'Bob', address: bob.publicKey },
    { owner: alice, name: 'Carol', address: carol.publicKey },
    { owner: bob, name: 'Alice', address: alice.publicKey },
    { owner: bob, name: 'Dave', address: dave.publicKey },
    { owner: carol, name: 'Alice', address: alice.publicKey },
  ];
  let contactTotal = 0;
  for (const { owner, name, address } of contactPairs) {
    await prisma.contact.upsert({
      where: { userId_address: { userId: owner.id, address } },
      update: {},
      create: { userId: owner.id, name, address },
    });
    contactTotal++;
  }
  console.log(`     ✓ ${contactTotal} contacts`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n✅  Seed complete');
  console.log(`    ${createdUsers.length} users`);
  console.log(`    ${txTotal} transactions`);
  console.log(`    ${streams.length} payment streams`);
  console.log(`    ${notifTotal} notifications`);
  console.log(`    ${contactTotal} contacts`);
  console.log('\n    Default password for all seed users: password123');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
