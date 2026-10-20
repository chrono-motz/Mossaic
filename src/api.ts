export interface ServerApproval {
  approvalId: string
  planHash: string
  status: string
  planner: 'demo' | 'ai'
  catalogSource: 'demo-catalog' | 'channel3'
  amountMinor: number
  currencyCode: string
}

export interface ServerCompile {
  mission: import('./domain/types').MissionDraft
  plans: import('./domain/types').MissionPlan[]
  planner: 'demo' | 'ai'
  catalogSource: 'demo-catalog' | 'channel3'
  planHashes: Record<string, string>
}

export interface ServerPayment {
  paymentId: string
  paypalOrderId?: string
  approvalUrl?: string
  status: 'created' | 'paid' | 'failed'
  amountMinor: number
  currencyCode: string
  provider: 'demo' | 'paypal'
  failureReason?: string
}

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `Mosaic API returned ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

export function createServerApproval(missionId: string, brief: string, planKind: string, expectedPlanHash?: string): Promise<ServerApproval> {
  return post<ServerApproval>('/api/approvals', { missionId, brief, planKind, expectedPlanHash })
}

export function compileServerMission(missionId: string, brief: string): Promise<ServerCompile> {
  return post<ServerCompile>('/api/compile', { missionId, brief })
}

export function createServerPayment(missionId: string, approvalId: string, planHash: string): Promise<ServerPayment> {
  return post<ServerPayment>(
    `/api/missions/${encodeURIComponent(missionId)}/paypal/orders`,
    { approvalId, planHash },
    { 'Idempotency-Key': crypto.randomUUID() },
  )
}

export function captureServerPayment(paymentId: string): Promise<ServerPayment> {
  return post<ServerPayment>(`/api/payments/${encodeURIComponent(paymentId)}/capture`, {})
}
