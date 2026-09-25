/**
 * Event Archiver — moves old events from the hot EventStore table to the
 * EventArchive table, which is backed by Postgres via Prisma.  Replaces the
 * old local-file approach that wrote archive files to backend/data/archive/
 * and was not visible to other process instances.
 *
 * Migrated as part of Issue #1125.
 *
 * When EVENT_ARCHIVE_S3_BUCKET is set, every batch is also written to S3 as a
 * gzipped NDJSON object and verified (SHA-256 via HeadObject, then a full
 * download re-hashed and record-counted) before any hot row is deleted
 * (#1361). Deletion runs in the same transaction as the EventArchive insert and
 * rolls back unless exactly the archived rows were removed.
 */
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const BATCH_SIZE = parseInt(process.env.EVENT_ARCHIVE_BATCH_SIZE, 10) || 5000;

export class ArchiveVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchiveVerificationError';
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest();
}

function toArchiveRecord(e) {
  return {
    id: e.id,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    payload: e.payload,
    version: e.version,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  };
}

class EventArchiver {
  /**
   * @param {{ s3Client?: S3Client, bucket?: string|null, prefix?: string }} [options]
   */
  constructor({
    s3Client = null,
    bucket = process.env.EVENT_ARCHIVE_S3_BUCKET || null,
    prefix = process.env.EVENT_ARCHIVE_S3_PREFIX || 'event-archive',
  } = {}) {
    this.bucket = bucket;
    this.prefix = prefix;
    this.s3Client = s3Client;
  }

  get s3() {
    if (!this.s3Client) {
      this.s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
    }
    return this.s3Client;
  }

  /**
   * Move events older than `olderThanDays` from EventStore → EventArchive (and
   * S3 when configured) and delete them from the hot table, one verified batch
   * at a time. A failed verification aborts the run; batches already
   * committed stay archived, nothing from the failing batch is deleted.
   *
   * @param {number} [olderThanDays=30]
   * @returns {Promise<{ events: number, aggregates: number, objects: object[] }>}
   */
  async archiveOldEvents(olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    let events = 0;
    const aggregateIds = new Set();
    const objects = [];

    for (;;) {
      const batch = await prisma.eventStore.findMany({
        where: { createdAt: { lt: cutoffDate } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const object = await this.archiveBatch(batch, cutoffDate);
      if (object) objects.push(object);

      events += batch.length;
      for (const e of batch) aggregateIds.add(e.aggregateId);

      if (batch.length < BATCH_SIZE) break;
    }

    return { events, aggregates: aggregateIds.size, objects };
  }

  async archiveBatch(batch, cutoffDate) {
    const ids = batch.map((e) => e.id);
    const body = gzipSync(batch.map((e) => JSON.stringify(toArchiveRecord(e))).join('\n') + '\n');
    const digest = sha256(body);
    const sha256Hex = digest.toString('hex');

    let object = null;
    if (this.bucket) {
      const key = `${this.prefix}/${cutoffDate.toISOString().slice(0, 10)}/${batch[0].createdAt.toISOString()}_${sha256Hex.slice(0, 16)}.ndjson.gz`;
      await this.uploadAndVerify(key, body, digest, ids);
      object = { bucket: this.bucket, key, sha256: sha256Hex, records: ids.length };
    }

    await prisma.$transaction(async (tx) => {
      const inserted = await tx.eventArchive.createMany({
        data: batch.map((e) => ({
          aggregateId: e.aggregateId,
          eventType: e.eventType,
          payload: e.payload,
          version: e.version,
          metadata: e.metadata,
          originalCreatedAt: e.createdAt,
          archiveKey: object?.key ?? null,
          archiveSha256: sha256Hex,
        })),
      });
      if (inserted.count !== ids.length) {
        throw new ArchiveVerificationError(
          `Archive insert wrote ${inserted.count} rows, expected ${ids.length}; aborting deletion`
        );
      }

      const deleted = await tx.eventStore.deleteMany({ where: { id: { in: ids } } });
      if (deleted.count !== ids.length) {
        throw new ArchiveVerificationError(
          `Deleted ${deleted.count} hot rows, expected ${ids.length} (concurrent archive run?); rolling back`
        );
      }
    });

    logger.info('Archived event batch', { records: ids.length, sha256: sha256Hex, key: object?.key });
    return object;
  }

  /**
   * Upload `body` and prove the stored object is byte-identical and holds
   * exactly `ids`, in order. Throws ArchiveVerificationError otherwise.
   */
  async uploadAndVerify(key, body, digest, ids) {
    const checksum = digest.toString('base64');

    // S3 rejects the PUT itself if the received bytes do not hash to ChecksumSHA256.
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/gzip',
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: checksum,
        Metadata: { 'record-count': String(ids.length), sha256: digest.toString('hex') },
      })
    );

    const head = await this.s3.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' })
    );
    if (head.ChecksumSHA256 !== checksum) {
      throw new ArchiveVerificationError(
        `S3 checksum mismatch for ${key}: expected ${checksum}, got ${head.ChecksumSHA256 ?? 'none'}`
      );
    }
    if (head.ContentLength !== body.length) {
      throw new ArchiveVerificationError(
        `S3 object ${key} is ${head.ContentLength} bytes, expected ${body.length}`
      );
    }

    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const downloaded = Buffer.from(await object.Body.transformToByteArray());
    if (!sha256(downloaded).equals(digest)) {
      throw new ArchiveVerificationError(`Downloaded archive ${key} does not match the uploaded SHA-256`);
    }

    let records;
    try {
      records = gunzipSync(downloaded)
        .toString('utf8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch (error) {
      throw new ArchiveVerificationError(`Archive ${key} is not readable: ${error.message}`);
    }

    if (records.length !== ids.length) {
      throw new ArchiveVerificationError(
        `Archive ${key} holds ${records.length} records, expected ${ids.length}`
      );
    }
    for (let i = 0; i < ids.length; i++) {
      if (records[i].id !== ids[i]) {
        throw new ArchiveVerificationError(`Archive ${key} record ${i} is ${records[i].id}, expected ${ids[i]}`);
      }
    }
  }

  /**
   * Retrieve all archived events for an aggregate, sorted by original creation
   * time (ascending).
   *
   * @param {string} aggregateId
   * @returns {Promise<object[]>}
   */
  async getArchivedEvents(aggregateId) {
    const records = await prisma.eventArchive.findMany({
      where: { aggregateId },
      orderBy: { originalCreatedAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.originalCreatedAt.toISOString(),
      metadata: r.metadata,
    }));
  }

  /**
   * Return archived events for an aggregate that were originally created on or
   * before `toDate`.
   *
   * @param {string} aggregateId
   * @param {string|Date} toDate
   * @returns {Promise<object[]>}
   */
  async restoreFromArchive(aggregateId, toDate) {
    const cutoff = new Date(toDate);
    const records = await prisma.eventArchive.findMany({
      where: {
        aggregateId,
        originalCreatedAt: { lte: cutoff },
      },
      orderBy: { originalCreatedAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      aggregateId: r.aggregateId,
      type: r.eventType,
      data: r.payload,
      version: r.version,
      timestamp: r.originalCreatedAt.toISOString(),
      metadata: r.metadata,
    }));
  }
}

export { EventArchiver };
export default new EventArchiver();
