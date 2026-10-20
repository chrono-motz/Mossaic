import { createHash, randomUUID } from 'node:crypto'

export interface ApprovalPlanItem {
  id: string
  quantity: number
  unitPrice: number
}

export interface ApprovalPlanSnapshot {
  missionId: string
  planId: string
  currency: string
  total: number
  logisticsFee: number
  items: ApprovalPlanItem[]
}

export interface ApprovalRecord {
  id: string
  snapshot: ApprovalPlanSnapshot
  planHash: string
  createdAt: string
  status: 'approved' | 'stale' | 'revoked'
}

export interface PaymentRecord {
  id: string
  approvalId: string
  planHash: string
  amountMinor: number
  currencyCode: string
  paypalOrderId?: string
  approvalUrl?: string
  status: 'created' | 'paid' | 'failed'
  createIdempotencyKey: string
  captureIdempotencyKey: string
  failureReason?: string
  createdAt: string
  updatedAt: string
}

export const approvals = new Map<string, ApprovalRecord>()
export const payments = new Map<string, PaymentRecord>()
export const paymentsByIdempotencyKey = new Map<string, string>()
export const paymentIdByPayPalOrder = new Map<string, string>()

export function canonicalSnapshot(snapshot: ApprovalPlanSnapshot): string {
  return JSON.stringify({
    missionId: snapshot.missionId,
    planId: snapshot.planId,
    currency: snapshot.currency.toUpperCase(),
    total: Number(snapshot.total.toFixed(2)),
    logisticsFee: Number(snapshot.logisticsFee.toFixed(2)),
    items: [...snapshot.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => ({
        id: item.id,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice.toFixed(2)),
      })),
  })
}

export function hashSnapshot(snapshot: ApprovalPlanSnapshot): string {
  return createHash('sha256').update(canonicalSnapshot(snapshot)).digest('hex')
}

export function createApproval(snapshot: ApprovalPlanSnapshot): ApprovalRecord {
  const now = new Date().toISOString()
  const approval: ApprovalRecord = {
    id: `approval_${randomUUID()}`,
    snapshot,
    planHash: hashSnapshot(snapshot),
    createdAt: now,
    status: 'approved',
  }
  approvals.set(approval.id, approval)
  return approval
}

export function createPayment(approval: ApprovalRecord, idempotencyKey: string): PaymentRecord {
  const now = new Date().toISOString()
  const payment: PaymentRecord = {
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
  }
  payments.set(payment.id, payment)
  paymentsByIdempotencyKey.set(idempotencyKey, payment.id)
  return payment
}

export function publicPayment(payment: PaymentRecord) {
  return {
    paymentId: payment.id,
    paypalOrderId: payment.paypalOrderId,
    approvalUrl: payment.approvalUrl,
    status: payment.status,
    amountMinor: payment.amountMinor,
    currencyCode: payment.currencyCode,
    provider: payment.paypalOrderId?.startsWith('DEMO-') ? 'demo' as const : 'paypal' as const,
    failureReason: payment.failureReason,
  }
}
