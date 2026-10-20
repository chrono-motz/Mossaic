import { beforeEach, describe, expect, it } from 'vitest'
import {
  approvals,
  canonicalSnapshot,
  createApproval,
  createPayment,
  hashSnapshot,
  payments,
  paymentsByIdempotencyKey,
  publicPayment,
} from './store'

const snapshot = {
  missionId: 'mission-04',
  planId: 'plan-fastest',
  currency: 'USD',
  total: 4180.4,
  logisticsFee: 0,
  items: [
    { id: 'water', quantity: 7, unitPrice: 8.4 },
    { id: 'hygiene', quantity: 80, unitPrice: 8.4 },
  ],
}

describe('trusted approval and payment store', () => {
  beforeEach(() => {
    approvals.clear()
    payments.clear()
    paymentsByIdempotencyKey.clear()
  })

  it('hashes the canonical plan rather than trusting field order', () => {
    const reordered = { ...snapshot, items: [...snapshot.items].reverse() }

    expect(canonicalSnapshot(snapshot)).toBe(canonicalSnapshot(reordered))
    expect(hashSnapshot(snapshot)).toBe(hashSnapshot(reordered))
    expect(hashSnapshot({ ...snapshot, total: 4180.41 })).not.toBe(hashSnapshot(snapshot))
  })

  it('binds payment authority to the approved snapshot and idempotency key', () => {
    const approval = createApproval(snapshot)
    const payment = createPayment(approval, 'request-01')

    expect(payment.approvalId).toBe(approval.id)
    expect(payment.planHash).toBe(approval.planHash)
    expect(payment.amountMinor).toBe(418040)
    expect(paymentsByIdempotencyKey.get('request-01')).toBe(payment.id)
    expect(publicPayment(payment)).not.toHaveProperty('createIdempotencyKey')
  })
})
