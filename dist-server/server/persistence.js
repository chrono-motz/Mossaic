import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { hashSnapshot, } from './store.js';
/**
 * The schema is intentionally kept in one idempotent statement. This makes a
 * fresh Render/managed Postgres database self-initializing while preserving
 * existing rows on process restarts.
 */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  plan_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'stale', 'revoked'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  plan_hash TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency_code TEXT NOT NULL,
  paypal_order_id TEXT,
  approval_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'failed')),
  create_idempotency_key TEXT NOT NULL UNIQUE,
  capture_idempotency_key TEXT NOT NULL UNIQUE,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_order_id_idx
  ON payments (paypal_order_id)
  WHERE paypal_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_receipts (
  event_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL
);
`;
function requiredString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0)
        throw new Error(`${name} is required`);
    return value;
}
function timestamp(value) {
    if (value instanceof Date)
        return value.toISOString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        throw new Error('Stored timestamp is invalid');
    return parsed.toISOString();
}
/**
 * JSON is the common representation between MemoryPersistence and Postgres.
 * Normalising through JSON also means the demo adapter behaves like jsonb for
 * undefined object fields and non-finite numbers.
 */
function copyJson(value) {
    if (value === undefined)
        return null;
    const encoded = JSON.stringify(value);
    if (encoded === undefined)
        return null;
    return JSON.parse(encoded);
}
function jsonParameter(value) {
    const encoded = JSON.stringify(value === undefined ? null : value);
    if (encoded === undefined)
        throw new Error('Value must be JSON serializable');
    return encoded;
}
function approvalFromRow(row) {
    return {
        id: row.id,
        snapshot: copyJson(parseJson(row.snapshot)),
        planHash: row.plan_hash,
        createdAt: timestamp(row.created_at),
        status: row.status,
    };
}
function paymentFromRow(row) {
    const payment = {
        id: row.id,
        approvalId: row.approval_id,
        planHash: row.plan_hash,
        amountMinor: row.amount_minor,
        currencyCode: row.currency_code,
        status: row.status,
        createIdempotencyKey: row.create_idempotency_key,
        captureIdempotencyKey: row.capture_idempotency_key,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
    };
    if (row.paypal_order_id !== null && row.paypal_order_id !== undefined)
        payment.paypalOrderId = row.paypal_order_id;
    if (row.approval_url !== null && row.approval_url !== undefined)
        payment.approvalUrl = row.approval_url;
    if (row.failure_reason !== null && row.failure_reason !== undefined)
        payment.failureReason = row.failure_reason;
    return payment;
}
function webhookFromRow(row) {
    return {
        eventId: row.event_id,
        payload: copyJson(parseJson(row.payload)),
        receivedAt: timestamp(row.received_at),
    };
}
function parseJson(value) {
    if (typeof value === 'string')
        return JSON.parse(value);
    return value;
}
function buildApproval(snapshot) {
    const storedSnapshot = copyJson(snapshot);
    const now = new Date().toISOString();
    return {
        id: `approval_${randomUUID()}`,
        snapshot: storedSnapshot,
        planHash: hashSnapshot(storedSnapshot),
        createdAt: now,
        status: 'approved',
    };
}
function buildPayment(approval, idempotencyKey) {
    const now = new Date().toISOString();
    return {
        id: `payment_${randomUUID()}`,
        approvalId: approval.id,
        planHash: approval.planHash,
        amountMinor: Math.round(approval.snapshot.total * 100),
        currencyCode: approval.snapshot.currency.toUpperCase(),
        status: 'created',
        createIdempotencyKey: idempotencyKey,
        captureIdempotencyKey: `capture_${randomUUID()}`,
        createdAt: now,
        updatedAt: now,
    };
}
function copyApproval(approval) {
    return {
        ...approval,
        snapshot: copyJson(approval.snapshot),
    };
}
function copyPayment(payment) {
    return { ...payment };
}
function normaliseWebhookArguments(eventOrReceipt, payload, receivedAt) {
    const input = typeof eventOrReceipt === 'string'
        ? { eventId: eventOrReceipt, payload, receivedAt }
        : eventOrReceipt;
    const eventId = requiredString(input.eventId ?? input.id ?? '', 'eventId');
    return {
        eventId,
        payload: copyJson(input.payload),
        receivedAt: timestamp(input.receivedAt ?? new Date().toISOString()),
    };
}
function assertPaymentMatches(approval, payment) {
    if (payment.approvalId !== approval.id ||
        payment.planHash !== approval.planHash ||
        payment.amountMinor !== Math.round(approval.snapshot.total * 100) ||
        payment.currencyCode !== approval.snapshot.currency.toUpperCase()) {
        throw new Error('Idempotency key is already bound to a different payment');
    }
}
/**
 * Process-local implementation used by DEMO_MODE and unit tests. It mirrors
 * the database uniqueness rules rather than sharing the legacy global maps in
 * store.ts, so the adapter can be swapped without changing record semantics.
 */
export class MemoryPersistence {
    approvals = new Map();
    payments = new Map();
    paymentIdsByIdempotencyKey = new Map();
    webhookReceipts = new Map();
    initialized = false;
    closed = false;
    async initialize() {
        if (this.closed)
            throw new Error('Store is closed');
        this.initialized = true;
    }
    async close() {
        this.initialized = false;
        this.closed = true;
    }
    assertReady() {
        if (this.closed)
            throw new Error('Store is closed');
        if (!this.initialized)
            throw new Error('Store is not initialized');
    }
    async createApproval(snapshot) {
        this.assertReady();
        for (const existing of this.approvals.values()) {
            if (existing.snapshot.missionId === snapshot.missionId && existing.status === 'approved')
                existing.status = 'stale';
        }
        const approval = buildApproval(snapshot);
        this.approvals.set(approval.id, approval);
        return copyApproval(approval);
    }
    async getApproval(id) {
        this.assertReady();
        const approval = this.approvals.get(requiredString(id, 'approvalId'));
        return approval ? copyApproval(approval) : undefined;
    }
    async createPayment(approval, idempotencyKey) {
        this.assertReady();
        requiredString(idempotencyKey, 'idempotencyKey');
        const existingId = this.paymentIdsByIdempotencyKey.get(idempotencyKey);
        if (existingId) {
            const existing = this.payments.get(existingId);
            if (existing) {
                assertPaymentMatches(approval, existing);
                return copyPayment(existing);
            }
            this.paymentIdsByIdempotencyKey.delete(idempotencyKey);
        }
        const payment = buildPayment(approval, idempotencyKey);
        this.payments.set(payment.id, payment);
        this.paymentIdsByIdempotencyKey.set(payment.createIdempotencyKey, payment.id);
        return copyPayment(payment);
    }
    async getPayment(id) {
        this.assertReady();
        const payment = this.payments.get(requiredString(id, 'paymentId'));
        return payment ? copyPayment(payment) : undefined;
    }
    async getPaymentByIdempotencyKey(idempotencyKey) {
        this.assertReady();
        const paymentId = this.paymentIdsByIdempotencyKey.get(requiredString(idempotencyKey, 'idempotencyKey'));
        const payment = paymentId ? this.payments.get(paymentId) : undefined;
        return payment ? copyPayment(payment) : undefined;
    }
    async getPaymentByPayPalOrder(paypalOrderId) {
        this.assertReady();
        const paymentId = [...this.payments.values()].find((payment) => payment.paypalOrderId === requiredString(paypalOrderId, 'paypalOrderId'))?.id;
        return paymentId ? copyPayment(this.payments.get(paymentId)) : undefined;
    }
    async savePayment(payment) {
        this.assertReady();
        const existing = this.payments.get(requiredString(payment.id, 'paymentId'));
        if (!existing)
            throw new Error(`Payment not found: ${payment.id}`);
        const existingKeyOwner = this.paymentIdsByIdempotencyKey.get(payment.createIdempotencyKey);
        if (existingKeyOwner && existingKeyOwner !== payment.id)
            throw new Error('Idempotency key is already bound to a different payment');
        if (existing.createIdempotencyKey !== payment.createIdempotencyKey)
            this.paymentIdsByIdempotencyKey.delete(existing.createIdempotencyKey);
        this.paymentIdsByIdempotencyKey.set(payment.createIdempotencyKey, payment.id);
        this.payments.set(payment.id, copyPayment(payment));
    }
    async recordWebhook(eventOrReceipt, payload, receivedAt) {
        this.assertReady();
        const receipt = normaliseWebhookArguments(eventOrReceipt, payload, receivedAt);
        if (this.webhookReceipts.has(receipt.eventId))
            return false;
        this.webhookReceipts.set(receipt.eventId, receipt);
        return true;
    }
    async getWebhookReceipt(eventId) {
        this.assertReady();
        const receipt = this.webhookReceipts.get(requiredString(eventId, 'eventId'));
        return receipt ? { ...receipt, payload: copyJson(receipt.payload) } : undefined;
    }
}
/**
 * PostgreSQL-backed Store. The Pool is created lazily by the constructor but
 * does not connect or create tables until initialize() is awaited.
 */
export class PostgresPersistence {
    pool;
    initialized = false;
    closed = false;
    initializePromise;
    constructor(options = {}) {
        if (typeof options === 'string')
            options = { connectionString: options };
        if (options.pool) {
            this.pool = options.pool;
            return;
        }
        const connectionString = options.connectionString ?? options.databaseUrl ?? options.poolConfig?.connectionString ?? process.env.DATABASE_URL?.trim();
        if (!connectionString)
            throw new Error('DATABASE_URL is required for PostgresPersistence');
        this.pool = new Pool({ ...options.poolConfig, connectionString });
    }
    async initialize() {
        if (this.closed)
            throw new Error('Store is closed');
        if (this.initialized)
            return;
        if (!this.initializePromise) {
            this.initializePromise = this.pool.query(POSTGRES_SCHEMA)
                .then(() => {
                this.initialized = true;
            })
                .finally(() => {
                this.initializePromise = undefined;
            });
        }
        await this.initializePromise;
    }
    async close() {
        if (this.closed)
            return;
        this.closed = true;
        this.initialized = false;
        await this.pool.end();
    }
    assertReady() {
        if (this.closed)
            throw new Error('Store is closed');
        if (!this.initialized)
            throw new Error('Store is not initialized');
    }
    async createApproval(snapshot) {
        this.assertReady();
        const approval = buildApproval(snapshot);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`UPDATE approvals SET status = 'stale' WHERE snapshot->>'missionId' = $1 AND status = 'approved'`, [snapshot.missionId]);
            await client.query(`INSERT INTO approvals (id, snapshot, plan_hash, created_at, status)
         VALUES ($1, $2::jsonb, $3, $4, $5)`, [approval.id, jsonParameter(approval.snapshot), approval.planHash, approval.createdAt, approval.status]);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        return copyApproval(approval);
    }
    async getApproval(id) {
        this.assertReady();
        const result = await this.pool.query(`SELECT id, snapshot, plan_hash, created_at, status
       FROM approvals
       WHERE id = $1`, [requiredString(id, 'approvalId')]);
        const row = result.rows[0];
        return row ? approvalFromRow(row) : undefined;
    }
    async createPayment(approval, idempotencyKey) {
        this.assertReady();
        requiredString(idempotencyKey, 'idempotencyKey');
        const payment = buildPayment(approval, idempotencyKey);
        const insert = await this.pool.query(`INSERT INTO payments (
         id, approval_id, plan_hash, amount_minor, currency_code,
         paypal_order_id, approval_url, status, create_idempotency_key,
         capture_idempotency_key, failure_reason, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (create_idempotency_key) DO NOTHING
       RETURNING id, approval_id, plan_hash, amount_minor, currency_code,
         paypal_order_id, approval_url, status, create_idempotency_key,
         capture_idempotency_key, failure_reason, created_at, updated_at`, [
            payment.id,
            payment.approvalId,
            payment.planHash,
            payment.amountMinor,
            payment.currencyCode,
            null,
            null,
            payment.status,
            payment.createIdempotencyKey,
            payment.captureIdempotencyKey,
            null,
            payment.createdAt,
            payment.updatedAt,
        ]);
        const inserted = insert.rows[0];
        if (inserted)
            return paymentFromRow(inserted);
        const existing = await this.getPaymentByIdempotencyKey(idempotencyKey);
        if (!existing)
            throw new Error('Payment insert conflicted but no existing payment was found');
        assertPaymentMatches(approval, existing);
        return existing;
    }
    async getPayment(id) {
        this.assertReady();
        const result = await this.pool.query(`SELECT id, approval_id, plan_hash, amount_minor, currency_code,
         paypal_order_id, approval_url, status, create_idempotency_key,
         capture_idempotency_key, failure_reason, created_at, updated_at
       FROM payments
       WHERE id = $1`, [requiredString(id, 'paymentId')]);
        const row = result.rows[0];
        return row ? paymentFromRow(row) : undefined;
    }
    async getPaymentByIdempotencyKey(idempotencyKey) {
        this.assertReady();
        const result = await this.pool.query(`SELECT id, approval_id, plan_hash, amount_minor, currency_code,
         paypal_order_id, approval_url, status, create_idempotency_key,
         capture_idempotency_key, failure_reason, created_at, updated_at
       FROM payments
       WHERE create_idempotency_key = $1`, [requiredString(idempotencyKey, 'idempotencyKey')]);
        const row = result.rows[0];
        return row ? paymentFromRow(row) : undefined;
    }
    async getPaymentByPayPalOrder(paypalOrderId) {
        this.assertReady();
        const result = await this.pool.query(`SELECT id, approval_id, plan_hash, amount_minor, currency_code,
         paypal_order_id, approval_url, status, create_idempotency_key,
         capture_idempotency_key, failure_reason, created_at, updated_at
       FROM payments
       WHERE paypal_order_id = $1`, [requiredString(paypalOrderId, 'paypalOrderId')]);
        const row = result.rows[0];
        return row ? paymentFromRow(row) : undefined;
    }
    async savePayment(payment) {
        this.assertReady();
        const result = await this.pool.query(`UPDATE payments
       SET approval_id = $2,
           plan_hash = $3,
           amount_minor = $4,
           currency_code = $5,
           paypal_order_id = $6,
           approval_url = $7,
           status = $8,
           create_idempotency_key = $9,
           capture_idempotency_key = $10,
           failure_reason = $11,
           created_at = $12,
           updated_at = $13
       WHERE id = $1`, [
            requiredString(payment.id, 'paymentId'),
            payment.approvalId,
            payment.planHash,
            payment.amountMinor,
            payment.currencyCode,
            payment.paypalOrderId ?? null,
            payment.approvalUrl ?? null,
            payment.status,
            payment.createIdempotencyKey,
            payment.captureIdempotencyKey,
            payment.failureReason ?? null,
            payment.createdAt,
            payment.updatedAt,
        ]);
        if (result.rowCount !== 1)
            throw new Error(`Payment not found: ${payment.id}`);
    }
    async recordWebhook(eventOrReceipt, payload, receivedAt) {
        this.assertReady();
        const receipt = normaliseWebhookArguments(eventOrReceipt, payload, receivedAt);
        const result = await this.pool.query(`INSERT INTO webhook_receipts (event_id, payload, received_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (event_id) DO NOTHING`, [receipt.eventId, jsonParameter(receipt.payload), receipt.receivedAt]);
        return result.rowCount === 1;
    }
    async getWebhookReceipt(eventId) {
        this.assertReady();
        const result = await this.pool.query(`SELECT event_id, payload, received_at
       FROM webhook_receipts
       WHERE event_id = $1`, [requiredString(eventId, 'eventId')]);
        const row = result.rows[0];
        return row ? webhookFromRow(row) : undefined;
    }
}
//# sourceMappingURL=persistence.js.map