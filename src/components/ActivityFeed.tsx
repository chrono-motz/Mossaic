import { Bot, CheckCircle2, CircleDollarSign, Search, ShieldCheck, Truck } from 'lucide-react'
import type { MissionEvent } from '../domain/types'

interface ActivityFeedProps {
  events: MissionEvent[]
}

const icons = {
  Bot,
  Search,
  CheckCircle2,
  CircleDollarSign,
  ShieldCheck,
  Truck,
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <aside className="activity-card">
      <div className="activity-card__heading">
        <div>
          <span className="section-kicker">Agent trace</span>
          <h3>What Mosaic did</h3>
        </div>
        <span className="trace-live"><span className="live-dot" /> Live</span>
      </div>
      <div className="activity-list">
        {events.map((event) => {
          const Icon = icons[event.actor as keyof typeof icons] ?? Bot
          return (
            <div className={`activity-item activity-item--${event.tone}`} key={event.id}>
              <div className="activity-item__icon"><Icon size={15} /></div>
              <div>
                <div className="activity-item__meta"><b>{event.action}</b><time>{event.time}</time></div>
                <p>{event.detail}</p>
              </div>
            </div>
          )
        })}
      </div>
      <button className="text-button" type="button">Open full audit trace <span>↗</span></button>
    </aside>
  )
}
