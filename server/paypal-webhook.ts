const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com'
const PAYPAL_LIVE_API = 'https://api-m.paypal.com'

export const PAYPAL_CAPTURE_COMPLETED_EVENT = 'PAYMENT.CAPTURE.COMPLETED' as const
export const DEMO_PAYPAL_SIGNATURE_HEADER = 'x-demo-paypal-signature'
export const DEMO_PAYPAL_SIGNATURE = 'mosaic-demo-paypal-signature-v1'

const PAYPAL_EVENT_TYPES = [
  'CHECKOUT.ORDER.APPROVED',
  'CHECKOUT.ORDER.COMPLETED',
  'CHECKOUT.ORDER.PROCESSED',
  PAYPAL_CAPTURE_COMPLETED_EVENT,
  'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.DECLINED',
  'PAYMENT.CAPTURE.PENDING',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.SALE.COMPLETED',
] as const

export type PayPalWebhookEventType = (typeof PAYPAL_EVENT_TYPES)[number] | 'UNKNOWN'
export type SafePayPalEventType = PayPalWebhookEventType
export type ServerEnvironment = Readonly<Record<string, string | undefined>>
export type PayPalHeaderValue = string | readonly string[] | undefined
export type PayPalWebhookHeaders = Headers | Readonly<Record<string, PayPalHeaderValue>>

export interface SafePayPalWebhookEvent {
  readonly id?: string
  readonly eventType: PayPalWebhookEventType
  readonly event_type: PayPalWebhookEventType
  readonly rawEventType?: string
  readonly resourceType?: string
  readonly resource_type?: string
  readonly summary?: string
  readonly createTime?: string
  readonly create_time?: string
  readonly resource: Readonly<Record<string, unknown>>
}

/** Alias kept short for handlers that only need the normalized provider event. */
export type PayPalWebhookEvent = SafePayPalWebhookEvent

export type RawPayPalWebhookEvent = string | Uint8Array | Readonly<Record<string, unknown>>

export interface PayPalWebhookVerificationOptions {
  /** Defaults to process.env. Supplying this makes tests and workers deterministic. */
  readonly env?: ServerEnvironment
  /** Defaults to the process-global fetch implementation. */
  readonly fetch?: typeof fetch
  /** Optional REST base URL override, useful for a local PayPal-compatible test server. */
  readonly apiBaseUrl?: string
  readonly demoSignatureHeader?: string
  readonly demoSignature?: string
}

export type PayPalWebhookVerificationMode = 'paypal-rest' | 'demo' | 'unconfigured'

export interface PayPalWebhookVerificationResult {
  readonly verified: boolean
  readonly mode: PayPalWebhookVerificationMode
  readonly event?: SafePayPalWebhookEvent
  readonly reason?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function environmentValue(env: ServerEnvironment, name: string): string | undefined {
  return nonEmptyString(env[name])
}

function rawEventText(rawEvent: unknown): string {
  if (typeof rawEvent === 'string') {
    if (!rawEvent.trim()) throw new Error('PayPal webhook body is empty')
    return rawEvent
  }

  if (rawEvent instanceof Uint8Array) {
    const text = new TextDecoder().decode(rawEvent)
    if (!text.trim()) throw new Error('PayPal webhook body is empty')
    return text
  }

  const encoded = JSON.stringify(rawEvent)
  if (!encoded) throw new Error('PayPal webhook body must be JSON')
  return encoded
}

function parseRawEvent(rawEvent: unknown): { body: string; value: Record<string, unknown> } {
  const body = rawEventText(rawEvent)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('PayPal webhook body must be valid JSON')
  }
  if (!isRecord(parsed)) throw new Error('PayPal webhook body must be a JSON object')
  return { body, value: parsed }
}

function eventType(value: unknown): PayPalWebhookEventType {
  return typeof value === 'string' && (PAYPAL_EVENT_TYPES as readonly string[]).includes(value)
    ? value as PayPalWebhookEventType
    : 'UNKNOWN'
}

export function isPayPalWebhookEventType(value: unknown): value is PayPalWebhookEventType {
  return value === 'UNKNOWN' || (typeof value === 'string' && (PAYPAL_EVENT_TYPES as readonly string[]).includes(value))
}

/** Converts an untrusted provider payload into a small, typed event boundary. */
export function normalizePayPalWebhookEvent(rawEvent: unknown): SafePayPalWebhookEvent {
  const { value } = parseRawEvent(rawEvent)
  const suppliedType = nonEmptyString(value.event_type) ?? nonEmptyString(value.eventType)
  const normalizedType = eventType(suppliedType)
  const resource = isRecord(value.resource) ? { ...value.resource } : {}
  const normalized: SafePayPalWebhookEvent = {
    ...(nonEmptyString(value.id) ? { id: nonEmptyString(value.id) } : {}),
    eventType: normalizedType,
    event_type: normalizedType,
    ...(normalizedType === 'UNKNOWN' && suppliedType ? { rawEventType: suppliedType } : {}),
    ...(nonEmptyString(value.resource_type) ? { resourceType: nonEmptyString(value.resource_type), resource_type: nonEmptyString(value.resource_type) } : {}),
    ...(nonEmptyString(value.summary) ? { summary: nonEmptyString(value.summary) } : {}),
    ...(nonEmptyString(value.create_time) ? { createTime: nonEmptyString(value.create_time), create_time: nonEmptyString(value.create_time) } : {}),
    resource,
  }
  return normalized
}

function headerValue(headers: PayPalWebhookHeaders, name: string): string | undefined {
  const headerName = name.toLowerCase()
  if (typeof headers === 'object' && headers !== null) {
    const getter = (headers as { get?: (key: string) => string | null }).get
    if (typeof getter === 'function') return nonEmptyString(getter.call(headers, name))

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== headerName) continue
      if (Array.isArray(value)) return nonEmptyString(value[0])
      return nonEmptyString(value)
    }
  }
  return undefined
}

function demoModeEnabled(env: ServerEnvironment): boolean {
  return environmentValue(env, 'DEMO_MODE')?.toLowerCase() !== 'false'
}

function hasAnyPayPalCredential(env: ServerEnvironment): boolean {
  return Boolean(
    environmentValue(env, 'PAYPAL_CLIENT_ID')
    || environmentValue(env, 'PAYPAL_CLIENT_SECRET')
    || environmentValue(env, 'PAYPAL_WEBHOOK_ID'),
  )
}

export function isPayPalWebhookVerificationConfigured(env: ServerEnvironment = process.env): boolean {
  return Boolean(
    environmentValue(env, 'PAYPAL_CLIENT_ID')
    && environmentValue(env, 'PAYPAL_CLIENT_SECRET')
    && environmentValue(env, 'PAYPAL_WEBHOOK_ID'),
  )
}

function paypalApiBase(env: ServerEnvironment, override?: string): string {
  const configured = nonEmptyString(override)
    ?? environmentValue(env, 'PAYPAL_API_BASE_URL')
    ?? environmentValue(env, 'PAYPAL_BASE_URL')
  if (configured) return configured.replace(/\/$/, '')
  const environment = environmentValue(env, 'PAYPAL_ENVIRONMENT')?.toLowerCase()
  return environment === 'live' || environment === 'production' ? PAYPAL_LIVE_API : PAYPAL_SANDBOX_API
}

function failure(
  mode: PayPalWebhookVerificationMode,
  event: SafePayPalWebhookEvent | undefined,
  reason: string,
): PayPalWebhookVerificationResult {
  return { verified: false, mode, ...(event ? { event } : {}), reason }
}

async function jsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown
  } catch {
    return undefined
  }
}

async function verifyWithPayPalRest(
  event: SafePayPalWebhookEvent,
  providerEvent: Record<string, unknown>,
  headers: PayPalWebhookHeaders,
  clientId: string,
  clientSecret: string,
  webhookId: string,
  env: ServerEnvironment,
  options: PayPalWebhookVerificationOptions,
): Promise<PayPalWebhookVerificationResult> {
  const requiredHeaders = {
    authAlgo: headerValue(headers, 'paypal-auth-algo'),
    certUrl: headerValue(headers, 'paypal-cert-url'),
    transmissionId: headerValue(headers, 'paypal-transmission-id'),
    transmissionSig: headerValue(headers, 'paypal-transmission-sig'),
    transmissionTime: headerValue(headers, 'paypal-transmission-time'),
  }
  if (Object.values(requiredHeaders).some((value) => !value)) {
    return failure('paypal-rest', event, 'PayPal verification headers are incomplete')
  }

  const fetchImpl = options.fetch ?? globalThis.fetch
  if (!fetchImpl) return failure('paypal-rest', event, 'No fetch implementation is available')

  const baseUrl = paypalApiBase(env, options.apiBaseUrl)
  let accessToken: string | undefined
  try {
    const tokenResponse = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!tokenResponse.ok) return failure('paypal-rest', event, `PayPal OAuth returned HTTP ${tokenResponse.status}`)
    const tokenPayload = await jsonResponse(tokenResponse)
    accessToken = isRecord(tokenPayload) ? nonEmptyString(tokenPayload.access_token) : undefined
    if (!accessToken) return failure('paypal-rest', event, 'PayPal OAuth did not return an access token')

    const verificationResponse = await fetchImpl(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: requiredHeaders.authAlgo,
        cert_url: requiredHeaders.certUrl,
        transmission_id: requiredHeaders.transmissionId,
        transmission_sig: requiredHeaders.transmissionSig,
        transmission_time: requiredHeaders.transmissionTime,
        webhook_id: webhookId,
        webhook_event: providerEvent,
      }),
    })
    if (!verificationResponse.ok) return failure('paypal-rest', event, `PayPal webhook verification returned HTTP ${verificationResponse.status}`)
    const verificationPayload = await jsonResponse(verificationResponse)
    const status = isRecord(verificationPayload) ? nonEmptyString(verificationPayload.verification_status) : undefined
    if (status !== 'SUCCESS') return failure('paypal-rest', event, 'PayPal webhook signature was not accepted')
    return { verified: true, mode: 'paypal-rest', event }
  } catch {
    return failure('paypal-rest', event, 'PayPal webhook verification request failed')
  }
}

/**
 * Verifies a raw PayPal webhook body and returns its normalized event only when
 * the provider (or the explicit local demo signature) accepts it.
 */
export async function verifyPayPalWebhook(
  rawEvent: RawPayPalWebhookEvent,
  headers: PayPalWebhookHeaders,
  options: PayPalWebhookVerificationOptions = {},
): Promise<PayPalWebhookVerificationResult> {
  let parsed: { body: string; value: Record<string, unknown> }
  let event: SafePayPalWebhookEvent
  try {
    parsed = parseRawEvent(rawEvent)
    event = normalizePayPalWebhookEvent(parsed.value)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'PayPal webhook body is invalid'
    return failure('unconfigured', undefined, reason)
  }

  const env = options.env ?? process.env
  const clientId = environmentValue(env, 'PAYPAL_CLIENT_ID')
  const clientSecret = environmentValue(env, 'PAYPAL_CLIENT_SECRET')
  const webhookId = environmentValue(env, 'PAYPAL_WEBHOOK_ID')

  if (clientId && clientSecret && webhookId) {
    return verifyWithPayPalRest(event, parsed.value, headers, clientId, clientSecret, webhookId, env, options)
  }

  if (hasAnyPayPalCredential(env)) {
    return failure('unconfigured', event, 'PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID must be configured together')
  }

  if (!demoModeEnabled(env)) return failure('unconfigured', event, 'PayPal webhook verification is not configured')

  const signatureHeader = options.demoSignatureHeader ?? DEMO_PAYPAL_SIGNATURE_HEADER
  const expectedSignature = options.demoSignature ?? DEMO_PAYPAL_SIGNATURE
  if (headerValue(headers, signatureHeader) !== expectedSignature) {
    return failure('demo', event, `Missing or invalid ${signatureHeader} demo signature`)
  }
  return { verified: true, mode: 'demo', event }
}

/** Explicit alias for callers that want the raw-event wording in their handler. */
export const verifyRawPayPalEvent = verifyPayPalWebhook

/** Boolean convenience wrapper for handlers that do not need the normalized event yet. */
export async function isPayPalWebhookVerified(
  rawEvent: RawPayPalWebhookEvent,
  headers: PayPalWebhookHeaders,
  options: PayPalWebhookVerificationOptions = {},
): Promise<boolean> {
  return (await verifyPayPalWebhook(rawEvent, headers, options)).verified
}

function isNormalizedPayPalEvent(value: unknown): value is SafePayPalWebhookEvent {
  return isRecord(value)
    && isPayPalWebhookEventType(value.eventType)
    && isRecord(value.resource)
}

function resourceValue(resource: Readonly<Record<string, unknown>>, key: string): unknown {
  return resource[key]
}

/**
 * Extracts the PayPal order id from a completed capture event. Other event
 * types intentionally return undefined so a capture cannot fund a mission by
 * accident.
 */
export function extractPayPalOrderId(event: SafePayPalWebhookEvent | RawPayPalWebhookEvent): string | undefined {
  let normalized: SafePayPalWebhookEvent
  try {
    normalized = isNormalizedPayPalEvent(event) ? event : normalizePayPalWebhookEvent(event)
  } catch {
    return undefined
  }
  if (normalized.eventType !== PAYPAL_CAPTURE_COMPLETED_EVENT) return undefined

  const resource = normalized.resource
  const supplementary = isRecord(resourceValue(resource, 'supplementary_data')) ? resourceValue(resource, 'supplementary_data') as Record<string, unknown> : undefined
  const relatedIds = supplementary && isRecord(supplementary.related_ids) ? supplementary.related_ids : undefined
  const candidates = [
    relatedIds?.order_id,
    resourceValue(resource, 'order_id'),
    resourceValue(resource, 'orderId'),
    supplementary?.order_id,
  ]
  return candidates.map(nonEmptyString).find((value): value is string => Boolean(value))
}

/** Alias matching the payment-oriented wording used by application handlers. */
export const extractPaymentOrderId = extractPayPalOrderId
