interface SponsorBadgeProps {
  label: string
  tone?: 'lime' | 'blue' | 'orange' | 'violet' | 'muted'
}

export function SponsorBadge({ label, tone = 'muted' }: SponsorBadgeProps) {
  return <span className={`sponsor-badge sponsor-badge--${tone}`}>{label}</span>
}
