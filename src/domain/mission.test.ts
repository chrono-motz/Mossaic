import { describe, expect, it } from 'vitest'
import { applyPlanItemChoice, createPlans, parseMissionRequest, validatePlan } from './mission'

describe('Mosaic mission compiler', () => {
  it('extracts the commercial and deadline constraints from a mission brief', () => {
    const mission = parseMissionRequest('Create a cooling station for 120 people by 7:30 PM with a $6,000 budget. Prefer reusable supplies.')

    expect(mission.budget).toBe(6000)
    expect(mission.beneficiaries).toBe(120)
    expect(mission.deadline).toBe('2026-10-20T19:30:00')
    expect(mission.constraints).toContain('Prefer low-waste alternatives')
  })

  it('creates three competing plans with different trade-offs', () => {
    const mission = parseMissionRequest('Build a heat station for 80 people by 6 PM with a $4,500 budget.')
    const plans = createPlans(mission)

    expect(plans).toHaveLength(3)
    expect(new Set(plans.map((plan) => plan.kind))).toEqual(new Set(['fastest', 'balanced', 'low-waste']))
    expect(plans[0].metrics.arrivalMinutes).toBeLessThan(plans[1].metrics.arrivalMinutes)
    expect(plans[2].metrics.wasteScore).toBeGreaterThan(plans[0].metrics.wasteScore)
  })

  it('treats an AG Grid choice as a new plan revision and recalculates the money', () => {
    const mission = parseMissionRequest('Build a heat station by 6 PM with a $4,500 budget.')
    const plan = createPlans(mission)[0]
    const item = plan.items[0]
    const alternative = item.alternatives[2]
    const revised = applyPlanItemChoice(plan, item.id, alternative.id, mission.budget)

    expect(revised.items[0].selected.id).toBe(alternative.id)
    expect(revised.metrics.total).not.toBe(plan.metrics.total)
    expect(revised.status).toBe('proposed')
  })

  it('reports a budget conflict without silently accepting an invalid plan', () => {
    const mission = parseMissionRequest('Build a heat station by 6 PM with a $4,500 budget.')
    const plan = createPlans(mission)[0]
    const invalid = { ...plan, metrics: { ...plan.metrics, total: 5000, reserveRemaining: -500 } }

    expect(validatePlan(invalid, mission.budget)).toEqual([
      'Plan exceeds the approved budget by $500.00.',
      'The emergency reserve has been consumed.',
    ])
  })
})
