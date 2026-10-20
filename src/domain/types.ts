export type MissionStage = 'draft' | 'ready' | 'approved' | 'funding' | 'funded'

export type PlanKind = 'fastest' | 'balanced' | 'low-waste'

export type PaymentState = 'not_created' | 'created' | 'payer_approved' | 'paid' | 'failed'

export interface MissionDraft {
  title: string
  brief: string
  budget: number
  reserve: number
  deadline: string
  beneficiaries: number
  constraints: string[]
  parserConfidence: number
}

export interface ProductOption {
  id: string
  title: string
  brand: string
  price: number
  unit: string
  retailer: string
  delivery: string
  deliveryMinutes: number
  confidence: number
  wasteScore: number
  image?: string
  source: 'channel3' | 'demo-catalog'
}

export type MissionCatalog = Record<string, ProductOption[]>

export interface PlanItem {
  id: string
  category: string
  requirement: string
  quantity: number
  selected: ProductOption
  alternatives: ProductOption[]
  priority: 'essential' | 'recommended'
}

export interface MissionTask {
  id: string
  name: string
  lane: string
  start: string
  end: string
  durationMinutes: number
  dependencyIds: string[]
  status: 'queued' | 'ready' | 'at-risk' | 'complete'
}

export interface PlanMetrics {
  total: number
  arrival: string
  arrivalMinutes: number
  confidence: number
  wasteScore: number
  supplierCount: number
  reserveRemaining: number
}

export interface MissionPlan {
  id: string
  kind: PlanKind
  label: string
  kicker: string
  description: string
  color: string
  items: PlanItem[]
  tasks: MissionTask[]
  metrics: PlanMetrics
  decisionNotes: string[]
  status: 'proposed' | 'selected' | 'approved' | 'funded'
}

export interface PaymentRecord {
  state: PaymentState
  orderId?: string
  approvalUrl?: string
  provider?: 'demo' | 'paypal'
  amount?: number
  currency: string
  updatedAt?: string
  failureReason?: string
}

export interface MissionEvent {
  id: string
  time: string
  actor: string
  action: string
  detail: string
  tone: 'neutral' | 'success' | 'warning' | 'accent'
}
