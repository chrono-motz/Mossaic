import type { MissionDraft } from '../src/domain/types.js'
import { DEMO_DEADLINE, parseMissionRequest } from '../src/domain/mission.js'
import type { AgAiOutputItem, AgLlmRequest, AgLlmResponse } from 'ag-studio'

export type PlannerProvider = 'demo' | 'ai'

function aiConfig() {
  return {
    apiKey: process.env.AI_API_KEY?.trim(),
    baseUrl: (process.env.AI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL?.trim() || 'gpt-4o-mini',
  }
}

export function isAiConfigured(): boolean {
  return process.env.AI_ENABLED !== 'false' && Boolean(aiConfig().apiKey)
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function asConstraints(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8)
}

function normalizeDraft(value: unknown, originalBrief: string): MissionDraft {
  const fallback = parseMissionRequest(originalBrief)
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const deadline = asString(candidate.deadline, fallback.deadline)
  const parsedDeadline = Number.isNaN(new Date(deadline).getTime()) ? DEMO_DEADLINE : new Date(deadline).toISOString().slice(0, 19)
  return {
    title: asString(candidate.title, fallback.title),
    brief: originalBrief,
    budget: Math.round(asNumber(candidate.budget, fallback.budget) * 100) / 100,
    reserve: Math.max(200, Math.round(asNumber(candidate.reserve, fallback.reserve) * 100) / 100),
    deadline: parsedDeadline,
    beneficiaries: Math.round(asNumber(candidate.beneficiaries, fallback.beneficiaries)),
    constraints: asConstraints(candidate.constraints, fallback.constraints),
    parserConfidence: Math.min(0.99, Math.max(0.5, asNumber(candidate.confidence, 0.9))),
  }
}

function parseJsonContent(content: string): unknown {
  const unfenced = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  return JSON.parse(unfenced)
}

export async function compileMissionDraft(brief: string): Promise<{ draft: MissionDraft; provider: PlannerProvider }> {
  if (!isAiConfigured()) return { draft: parseMissionRequest(brief), provider: 'demo' }
  const config = aiConfig()
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are Mosaic Planner. Convert a mission brief into safe structured planning facts. Never invent a payment or claim a product is available. Return only JSON with title, budget, reserve, deadline as ISO local datetime, beneficiaries, constraints array, and confidence between 0 and 1. If a fact is missing, use a conservative value and include a constraint asking for confirmation.',
        },
        { role: 'user', content: brief },
      ],
    }),
  })
  if (!response.ok) throw new Error(`AI planner returned HTTP ${response.status}`)
  const payload: unknown = await response.json()
  const content = payload && typeof payload === 'object'
    && 'choices' in payload && Array.isArray(payload.choices)
    && payload.choices[0] && typeof payload.choices[0] === 'object'
    && 'message' in payload.choices[0] && payload.choices[0].message && typeof payload.choices[0].message === 'object'
    && 'content' in payload.choices[0].message && typeof payload.choices[0].message.content === 'string'
    ? payload.choices[0].message.content
    : null
  if (!content) throw new Error('AI planner returned no structured content')
  return { draft: normalizeDraft(parseJsonContent(content), brief), provider: 'ai' }
}

function studioText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '').join('')
}

function studioMessages(request: AgLlmRequest): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  if (request.instructions) messages.push({ role: 'system', content: request.instructions })
  for (const item of request.input) {
    if (item.kind === 'input' && item.type === 'message') {
      messages.push({ role: item.role, content: item.content.map((part) => part.type === 'text' ? part.text : `[${part.type}]`).join('\n') })
      continue
    }
    if (item.kind === 'output' && item.type === 'message') {
      messages.push({ role: 'assistant', content: studioText(item.content) })
      continue
    }
    if (item.kind === 'output' && item.type === 'function_call') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: item.callId, type: 'function', function: { name: item.name, arguments: item.arguments } }],
      })
      continue
    }
    if (item.kind === 'input' && item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: item.output })
    }
  }
  return messages
}

function studioTools(request: AgLlmRequest): Array<Record<string, unknown>> | undefined {
  if (!request.tools?.length) return undefined
  return request.tools.map((tool) => tool.provider && typeof tool.provider === 'object'
    ? tool.provider as Record<string, unknown>
    : {
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })
}

function demoStudioResponse(): AgLlmResponse {
  const id = `studio-demo-${Date.now()}`
  const output: AgAiOutputItem[] = [{
    id: `${id}-message`,
    kind: 'output',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'text', text: 'Studio Agent is ready. Ask me to compare mission cost, confidence, impact, or reshape this dashboard.', annotations: [] }],
  }]
  return { id, createdAt: Date.now(), output, status: 'completed', model: 'mosaic-demo-agent' }
}

/** Adapter endpoint for AG Studio's Agent Framework. Credentials remain server-side. */
export async function executeStudioLlmTurn(request: AgLlmRequest): Promise<AgLlmResponse> {
  if (!isAiConfigured()) return demoStudioResponse()
  const config = aiConfig()
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: request.model?.id ?? config.model,
      messages: studioMessages(request),
      tools: studioTools(request),
      tool_choice: request.toolChoice === 'none' ? 'none' : request.toolChoice === 'required' ? 'required' : 'auto',
      response_format: request.responseFormat.type === 'json' ? { type: 'json_object' } : { type: 'text' },
      temperature: 0.2,
    }),
  })
  if (!response.ok) throw new Error(`Studio AI returned HTTP ${response.status}`)
  const payload: unknown = await response.json()
  const message = payload && typeof payload === 'object' && 'choices' in payload && Array.isArray(payload.choices)
    && payload.choices[0] && typeof payload.choices[0] === 'object' && 'message' in payload.choices[0]
    && payload.choices[0].message && typeof payload.choices[0].message === 'object'
    ? payload.choices[0].message as Record<string, unknown>
    : {}
  const content = typeof message.content === 'string' ? message.content : ''
  const output: AgAiOutputItem[] = []
  if (content) {
    output.push({ id: `studio-message-${Date.now()}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: content, annotations: [] }] })
  }
  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (!toolCall || typeof toolCall !== 'object' || !('function' in toolCall) || !toolCall.function || typeof toolCall.function !== 'object') continue
      const functionCall = toolCall.function as Record<string, unknown>
      output.push({
        id: typeof toolCall.id === 'string' ? toolCall.id : `studio-tool-${Date.now()}`,
        kind: 'output',
        type: 'function_call',
        callId: typeof toolCall.id === 'string' ? toolCall.id : `studio-call-${Date.now()}`,
        name: typeof functionCall.name === 'string' ? functionCall.name : 'unknown_tool',
        arguments: typeof functionCall.arguments === 'string' ? functionCall.arguments : '{}',
        status: 'completed',
      })
    }
  }
  return { id: `studio-${Date.now()}`, createdAt: Date.now(), output, status: 'completed', model: config.model }
}
