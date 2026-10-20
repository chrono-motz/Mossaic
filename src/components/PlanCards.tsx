import { Check, Clock3, Leaf, ShieldCheck, WalletCards } from 'lucide-react'
import type { MissionPlan } from '../domain/types'
import { formatMoney } from '../domain/mission'

interface PlanCardsProps {
  plans: MissionPlan[]
  selectedPlanId: string
  onSelect: (planId: string) => void
}

const icons = {
  fastest: Clock3,
  balanced: WalletCards,
  'low-waste': Leaf,
}

export function PlanCards({ plans, selectedPlanId, onSelect }: PlanCardsProps) {
  return (
    <div className="plan-cards" role="list" aria-label="Competing AI plans">
      {plans.map((plan) => {
        const Icon = icons[plan.kind]
        const selected = plan.id === selectedPlanId
        return (
          <button
            type="button"
            role="listitem"
            key={plan.id}
            className={`plan-card ${selected ? 'plan-card--selected' : ''}`}
            style={{ '--plan-color': plan.color } as React.CSSProperties}
            onClick={() => onSelect(plan.id)}
            aria-pressed={selected}
          >
            <div className="plan-card__topline">
              <span className="plan-card__icon"><Icon size={16} /></span>
              {selected && <span className="plan-card__selected"><Check size={13} /> Selected</span>}
            </div>
            <span className="eyebrow">{plan.kicker}</span>
            <strong>{plan.label}</strong>
            <p>{plan.description}</p>
            <div className="plan-card__stats">
              <span><b>{formatMoney(plan.metrics.total)}</b><small>total</small></span>
              <span><b>{plan.metrics.arrival}</b><small>arrival</small></span>
              <span><b>{Math.round(plan.metrics.confidence * 100)}%</b><small>confidence</small></span>
            </div>
            <div className="plan-card__bar"><span style={{ width: `${plan.metrics.confidence * 100}%` }} /></div>
            <div className="plan-card__footnote"><ShieldCheck size={13} /> {plan.metrics.supplierCount} suppliers · {Math.round(plan.metrics.wasteScore * 100)} impact score</div>
            <span className="plan-card__sr">{selected ? 'Currently selected' : 'Select this plan'}</span>
          </button>
        )
      })}
    </div>
  )
}
