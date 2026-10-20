import type { ReactNode } from 'react'

interface MetricCardProps {
  eyebrow: string
  value: string
  detail: string
  icon: ReactNode
  tone: 'lime' | 'blue' | 'orange' | 'violet'
}

export function MetricCard({ eyebrow, value, detail, icon, tone }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__icon">{icon}</div>
      <p className="eyebrow">{eyebrow}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  )
}
