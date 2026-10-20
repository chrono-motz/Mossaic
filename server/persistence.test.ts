import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryPersistence, POSTGRES_SCHEMA, type Store } from './persistence'

const snapshot = {
  missionId: 'mission-04',
  planId: 'plan-fastest',
  currency: 'usd',
  total: 4180.4,
  logisticsFee: 0,
  items: [
    { id: 'water', quantity: 7, unitPrice: 8.4 },
    { id: 'hygiene', quantity: 80, unitPrice: 8.4 },
  ],
}

describe('MemoryPersistence', () => {
  let store: Store

  beforeEach(async () => {
    store = new MemoryPersistence()
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('round trips approvals and payments without exposing mutable adapter state', async () => {
    const approval = await store.createApproval(snapshot)
    const approvalCopy = await store.getApproval(approval.id)
    expect(approvalCopy).toEqual(approval)

    approvalCopy!.snapshot.items[0].quantity = 999
    expect((await store.getApproval(approval.id))!.snapshot.items[0].quantity).toBe(7)

    const payment = await store.createPayment(approval, 'request-01')
    expect(await store.getPayment(payment.id)).toEqual(payment)
    expect(await store.getPaymentByIdempotencyKey('request-01')).toEqual(payment)

    payment.paypalOrderId = 'DEMO-123'
    payment.status = 'paid'
    await store.savePayment(payment)
    expect((await store.getPayment(payment.id))!.status).toBe('paid')
    expect((await store.getPayment(payment.id))!.paypalOrderId).toBe('DEMO-123')
  })

  it('returns the same payment for a repeated idempotency key', async () => {
    const approval = await store.createApproval(snapshot)
    const first = await store.createPayment(approval, 'request-02')
    const second = await store.createPayment(approval, 'request-02')

    expect(second).toEqual(first)
    await expect(store.createPayment({ ...approval, id: 'other-approval' }, 'request-02')).rejects.toThrow('Idempotency key')
  })

  it('stales the previous approved revision for the same mission', async () => {
    const first = await store.createApproval(snapshot)
    const second = await store.createApproval({ ...snapshot, total: 4181 })

    expect((await store.getApproval(first.id))!.status).toBe('stale')
    expect((await store.getApproval(second.id))!.status).toBe('approved')
  })

  it('deduplicates webhook receipts and returns a defensive payload copy', async () => {
    const payload = { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'capture-01' } }
    expect(await store.recordWebhook('webhook-01', payload, '2026-01-02T03:04:05.000Z')).toBe(true)
    expect(await store.recordWebhook('webhook-01', { changed: true })).toBe(false)

    const receipt = await store.getWebhookReceipt('webhook-01')
    expect(receipt).toEqual({ eventId: 'webhook-01', payload, receivedAt: '2026-01-02T03:04:05.000Z' })
    const storedPayload = receipt!.payload as { resource: { id: string } }
    storedPayload.resource.id = 'changed'
    expect((await store.getWebhookReceipt('webhook-01'))!.payload).toEqual(payload)
  })
})

describe('Postgres schema', () => {
  it('creates all persistence tables and indexes idempotently', () => {
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS approvals')
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS payments')
    expect(POSTGRES_SCHEMA).toContain('CREATE TABLE IF NOT EXISTS webhook_receipts')
    expect(POSTGRES_SCHEMA).toContain('ON payments (paypal_order_id)')
  })
})
