import { useMemo } from 'react'
import { createAiHarness } from 'ag-studio'
import { AgStudio } from 'ag-studio-react'
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmResponse, AgStudioApi } from 'ag-studio'
import type { MissionEvent, MissionPlan } from '../domain/types'

interface StudioAnalyticsProps {
  plan: MissionPlan
  events: MissionEvent[]
}

export function StudioAnalytics({ plan, events }: StudioAnalyticsProps) {
  const studioAdapter = useMemo<AgLlmAdapter>(() => ({
    executeTurn(request) {
      const complete = fetch('/api/studio/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Studio Agent returned HTTP ${response.status}`)
        return await response.json() as AgLlmResponse
      }).catch(() => ({
        id: `studio-offline-${Date.now()}`,
        createdAt: Date.now(),
        output: [{
          id: `studio-offline-message-${Date.now()}`,
          kind: 'output' as const,
          type: 'message' as const,
          role: 'assistant' as const,
          status: 'completed' as const,
          content: [{ type: 'text' as const, text: 'Start the Mosaic API to connect the Studio Agent. The dashboard remains available in local mode.', annotations: [] }],
        }],
        status: 'completed' as const,
        model: 'mosaic-offline-agent',
      }))

      const stream = {
        async *[Symbol.asyncIterator](): AsyncGenerator<AgAiEvent> {
          const response = await complete
          for (const item of response.output as AgAiOutputItem[]) {
            if (item.type === 'message') {
              const text = item.content.find((part) => part.type === 'text')
              if (text?.type === 'text') yield { type: 'TEXT_MESSAGE_CHUNK', messageId: item.id, role: 'assistant', delta: text.text }
            } else if (item.type === 'function_call') {
              yield { type: 'TOOL_CALL_CHUNK', toolCallId: item.callId, toolCallName: item.name, delta: item.arguments }
            }
          }
        },
      }
      return { complete, stream }
    },
  }), [])

  const studioAi = useMemo(() => (params: { api: AgStudioApi }) => createAiHarness(params.api, {
    adapter: studioAdapter,
    primary: 'lead',
    promptStarters: [
      { label: 'Summarise this mission', prompt: 'Summarise the current mission plan and its biggest risk.' },
      { label: 'Compare trade-offs', prompt: 'Compare cost, confidence, and impact in this dashboard.' },
    ],
  }), [studioAdapter])

  const data = {
    sources: [
      {
        id: 'plan_items',
        data: plan.items.map((item) => ({
          category: item.category,
          requirement: item.requirement,
          supplier: item.selected.retailer,
          amount: Number((item.quantity * item.selected.price).toFixed(2)),
          confidence: Math.round(item.selected.confidence * 100),
          impact: Math.round(item.selected.wasteScore * 100),
          arrival: item.selected.delivery,
        })),
      },
      {
        id: 'mission_events',
        data: events.map((event) => ({
          actor: event.actor,
          action: event.action,
          tone: event.tone,
          time: event.time,
        })),
      },
    ],
  }

  return (
    <section className="studio-panel" data-testid="ag-studio-panel">
      <div className="studio-panel__heading">
        <div>
          <span className="section-kicker">AG Studio · self-serve analytics</span>
          <h2>Mission intelligence canvas</h2>
          <p>Build a view of cost, confidence and impact from the same plan data the agents use.</p>
        </div>
        <div className="studio-panel__agent"><span className="sparkle-mark">✦</span> Studio Agent ready</div>
      </div>
      <div className="studio-host">
        <AgStudio data={data} mode="edit" ai={studioAi} />
      </div>
    </section>
  )
}
