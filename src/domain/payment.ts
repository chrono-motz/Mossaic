import type { MissionPlan, PaymentRecord } from './types'

export function approvePlan(plan: MissionPlan, budget: number): { ok: true; approvalId: string } | { ok: false; reason: string } {
  if (plan.metrics.total > budget) return { ok: false, reason: 'Select a plan that fits the approved budget before authorising payment.' }
  if (plan.metrics.reserveRemaining < 200) return { ok: false, reason: 'Keep at least $200 in the emergency reserve.' }
  return { ok: true, approvalId: `approval-${plan.id}-${Math.round(plan.metrics.total * 100)}` }
}

export function createMockPayPalOrder(plan: MissionPlan, approvalId: string): PaymentRecord {
  return {
    state: 'created',
    orderId: `MOSAIC-${plan.id.toUpperCase()}-${approvalId.slice(-4)}`,
    approvalUrl: 'http://127.0.0.1:8787/paypal/demo-checkout',
    provider: 'demo',
    amount: plan.metrics.total,
    currency: 'USD',
    updatedAt: new Date().toISOString(),
  }
}

export function transitionPayment(payment: PaymentRecord, event: 'payer_approved' | 'paid' | 'failed'): PaymentRecord {
  if (payment.state === 'paid') return payment
  if (event === 'payer_approved' && payment.state === 'created') return { ...payment, state: 'payer_approved', updatedAt: new Date().toISOString() }
  if (event === 'paid' && (payment.state === 'payer_approved' || payment.state === 'created')) return { ...payment, state: 'paid', updatedAt: new Date().toISOString() }
  if (event === 'failed') return { ...payment, state: 'failed', failureReason: 'Sandbox capture was declined. Try the approved plan again.', updatedAt: new Date().toISOString() }
  return payment
}
