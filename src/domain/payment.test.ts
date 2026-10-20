import { describe, expect, it } from 'vitest'
import { approvePlan, createMockPayPalOrder, transitionPayment } from './payment'
import { createPlans, parseMissionRequest } from './mission'

describe('Mosaic payment gate', () => {
  const mission = parseMissionRequest('Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.')
  const plan = createPlans(mission)[0]

  it('requires budget and reserve headroom before approval', () => {
    expect(approvePlan(plan, mission.budget)).toMatchObject({ ok: true })
    expect(approvePlan(plan, plan.metrics.total - 1)).toMatchObject({ ok: false })
  })

  it('creates an order tied to the approved plan and exact amount', () => {
    const approval = approvePlan(plan, mission.budget)
    if (!approval.ok) throw new Error('fixture should be approvable')
    const order = createMockPayPalOrder(plan, approval.approvalId)

    expect(order.state).toBe('created')
    expect(order.amount).toBe(plan.metrics.total)
    expect(order.orderId).toContain('MOSAIC-PLAN-FASTEST')
  })

  it('makes capture idempotent and never downgrades a paid order', () => {
    const approval = approvePlan(plan, mission.budget)
    if (!approval.ok) throw new Error('fixture should be approvable')
    const created = createMockPayPalOrder(plan, approval.approvalId)
    const approved = transitionPayment(created, 'payer_approved')
    const paid = transitionPayment(approved, 'paid')

    expect(paid.state).toBe('paid')
    expect(transitionPayment(paid, 'failed')).toEqual(paid)
    expect(transitionPayment(paid, 'paid')).toEqual(paid)
  })
})
