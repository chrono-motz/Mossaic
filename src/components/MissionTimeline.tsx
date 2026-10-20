import { useMemo } from 'react'
import { BryntumScheduler } from '@bryntum/scheduler-react'
import type { BryntumSchedulerProps } from '@bryntum/scheduler-react'
import type { MissionPlan } from '../domain/types'

interface MissionTimelineProps {
  plan: MissionPlan
}

export function MissionTimeline({ plan }: MissionTimelineProps) {
  const schedulerProps = useMemo<BryntumSchedulerProps>(() => ({
    startDate: new Date('2026-10-20T10:00:00'),
    endDate: new Date('2026-10-20T18:30:00'),
    viewPreset: 'hourAndDay',
    rowHeight: 44,
    barMargin: 6,
    eventStyle: 'filled',
    columns: [
      { text: 'Mission lane', field: 'name', width: 150 },
    ],
    resources: [
      { id: 'Mosaic finance', name: 'Mosaic finance' },
      { id: 'Commerce agent', name: 'Commerce agent' },
      { id: 'Supplier hub', name: 'Supplier hub' },
      { id: 'Field team', name: 'Field team' },
    ],
    events: plan.tasks.map((task) => ({
      id: task.id,
      resourceId: task.lane,
      name: task.name,
      startDate: new Date(task.start),
      endDate: new Date(task.end),
      eventColor: task.status === 'at-risk' ? 'orange' : task.status === 'ready' ? 'green' : 'blue',
    })),
    dependencies: plan.tasks.flatMap((task) => task.dependencyIds.map((fromEvent) => ({
      fromEvent,
      toEvent: task.id,
    }))),
    readOnly: true,
    zoomOnMouseWheel: false,
    infiniteScroll: false,
  }), [plan])

  return (
    <div className="timeline-shell" data-testid="bryntum-timeline">
      <div className="timeline-toolbar">
        <div>
          <span className="timeline-kicker">Bryntum Scheduler</span>
          <strong>Mission dependencies</strong>
        </div>
        <span className="timeline-deadline">Hard deadline · 6:00 PM</span>
      </div>
      <div className="scheduler-host">
        <BryntumScheduler {...schedulerProps} />
      </div>
    </div>
  )
}
