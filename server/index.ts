import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve } from 'node:path'
import type { AgLlmRequest } from 'ag-studio'
import { catalog, createPlans } from '../src/domain/mission.js'
import type { MissionCatalog, MissionPlan } from '../src/domain/types.js'
import { compileMissionDraft, executeStudioLlmTurn, isAiConfigured, type PlannerProvider } from './ai.js'
import { notifyMissionFunded } from './automation.js'
import { isChannel3Configured, searchMissionCatalog } from './channel3.js'
import { capturePayPalOrder, createPayPalOrder, isPayPalConfigured } from './paypal.js'
import { extractPayPalOrderId, PAYPAL_CAPTURE_COMPLETED_EVENT, verifyPayPalWebhook } from './paypal-webhook.js'
import { MemoryPersistence, PostgresPersistence, type Store } from './persistence.js'
import { hashSnapshot, publicPayment, type ApprovalPlanSnapshot } from './store.js'

const port = Number(process.env.PORT ?? 8787)
const demoMode = process.env.DEMO_MODE !== 'false'
let liveCatalogPromise: Promise<MissionCatalog> | undefined
const persistence: Store = process.env.DATABASE_URL?.trim()
  ? new PostgresPersistence()
  : new MemoryPersistence()

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.PUBLIC_APP_ORIGIN ?? '*',
    'access-control-allow-headers': 'content-type, idempotency-key',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  return body
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request)
  if (!body) return {}
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body must be an object')
  return parsed as Record<string, unknown>
}

function stringInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function contentType(pathname: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }
  return types[extname(pathname)] ?? 'application/octet-stream'
}

async function serveFrontend(pathname: string, response: ServerResponse): Promise<void> {
  const root = resolve(process.cwd(), 'dist')
  let relativePath = 'index.html'
  try {
    const decodedPath = decodeURIComponent(pathname)
    if (decodedPath !== '/') relativePath = decodedPath.replace(/^\/+/, '')
  } catch {
    relativePath = 'index.html'
  }

  const candidate = resolve(root, relativePath)
  const insideRoot = candidate === root || candidate.startsWith(`${root}/`)
  let filePath = insideRoot ? candidate : resolve(root, 'index.html')
  try {
    if (!(await stat(filePath)).isFile()) filePath = resolve(root, 'index.html')
  } catch {
    filePath = resolve(root, 'index.html')
  }

  const body = await readFile(filePath)
  response.writeHead(200, {
    'content-type': contentType(filePath),
    'cache-control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  })
  response.end(body)
}

function catalogSource(): Promise<MissionCatalog> {
  if (demoMode) return Promise.resolve(catalog)
  if (!isChannel3Configured()) return Promise.reject(new Error('CHANNEL3_API_KEY is missing and DEMO_MODE is disabled'))
  liveCatalogPromise ??= searchMissionCatalog(process.env.CHANNEL3_API_KEY!.trim())
  return liveCatalogPromise
}

function snapshotForPlan(missionId: string, plan: MissionPlan): ApprovalPlanSnapshot {
  return {
    missionId,
    planId: plan.id,
    currency: 'USD',
    total: plan.metrics.total,
    logisticsFee: 0,
    items: plan.items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.selected.price })),
  }
}

async function compileMission(body: Record<string, unknown>, missionId = 'unbound-mission'): Promise<{ mission: Awaited<ReturnType<typeof compileMissionDraft>>['draft']; plans: ReturnType<typeof createPlans>; planner: PlannerProvider; catalogSource: 'demo-catalog' | 'channel3'; planHashes: Record<string, string> }> {
  const brief = stringInput(body.brief, 'brief')
  const compiled = await compileMissionDraft(brief)
  const sourceCatalog = await catalogSource()
  const plans = createPlans(compiled.draft, sourceCatalog)
  return {
    mission: compiled.draft,
    plans,
    planner: compiled.provider,
    catalogSource: demoMode ? 'demo-catalog' : 'channel3',
    planHashes: Object.fromEntries(plans.map((plan) => [plan.kind, hashSnapshot(snapshotForPlan(missionId, plan))])),
  }
}

async function createMissionApproval(body: Record<string, unknown>) {
  const missionId = stringInput(body.missionId, 'missionId')
  const planKind = stringInput(body.planKind, 'planKind')
  const expectedPlanHash = typeof body.expectedPlanHash === 'string' ? body.expectedPlanHash : undefined
  if (!['fastest', 'balanced', 'low-waste'].includes(planKind)) throw new Error('planKind is invalid')

  const compiled = await compileMission(body, missionId)
  const plan = compiled.plans.find((candidate) => candidate.kind === planKind)
  if (!plan) throw new Error('Plan not found')
  if (expectedPlanHash && compiled.planHashes[planKind] !== expectedPlanHash) throw new Error('The plan changed while approval was pending. Recompile before approving.')
  if (plan.metrics.total > compiled.mission.budget || plan.metrics.reserveRemaining < 200) throw new Error('Plan cannot be approved within the budget and reserve rules')

  const snapshot = snapshotForPlan(missionId, plan)
  return { approval: await persistence.createApproval(snapshot), planner: compiled.planner, catalogSource: compiled.catalogSource }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `127.0.0.1:${port}`}`)
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { ok: true, demoMode, aiConfigured: isAiConfigured(), channel3Configured: isChannel3Configured(), paypalConfigured: isPayPalConfigured() })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/compile') {
      const body = await readJson(request)
      const compileMissionId = typeof body.missionId === 'string' && body.missionId.trim() ? body.missionId.trim() : 'unbound-mission'
      const compiled = await compileMission(body, compileMissionId)
      sendJson(response, 200, compiled)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/studio/ai') {
      const result = await executeStudioLlmTurn(await readJson(request) as unknown as AgLlmRequest)
      sendJson(response, 200, result)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/approvals') {
      const result = await createMissionApproval(await readJson(request))
      sendJson(response, 201, { approvalId: result.approval.id, planHash: result.approval.planHash, status: result.approval.status, planner: result.planner, catalogSource: result.catalogSource, amountMinor: Math.round(result.approval.snapshot.total * 100), currencyCode: result.approval.snapshot.currency })
      return
    }

    const orderMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/paypal\/orders$/)
    if (request.method === 'POST' && orderMatch) {
      if (!demoMode && !isPayPalConfigured()) {
        sendJson(response, 503, { error: 'PayPal is not configured. Keep DEMO_MODE enabled for the local adapter.' })
        return
      }
      const body = await readJson(request)
      const approvalId = stringInput(body.approvalId, 'approvalId')
      const planHash = stringInput(body.planHash, 'planHash')
      const idempotencyKey = stringInput(request.headers['idempotency-key'], 'Idempotency-Key')
      const approval = await persistence.getApproval(approvalId)
      if (!approval || approval.status !== 'approved' || approval.snapshot.missionId !== orderMatch[1] || approval.planHash !== planHash || hashSnapshot(approval.snapshot) !== approval.planHash) {
        sendJson(response, 409, { error: 'Approval is missing, stale, or does not match the current plan hash.' })
        return
      }
      const existingPayment = await persistence.getPaymentByIdempotencyKey(idempotencyKey)
      if (existingPayment) {
        sendJson(response, 200, publicPayment(existingPayment))
        return
      }
      const payment = await persistence.createPayment(approval, idempotencyKey)
      if (demoMode) {
        payment.paypalOrderId = `DEMO-${payment.id.replace('payment_', '').slice(0, 12).toUpperCase()}`
        payment.approvalUrl = `${process.env.PUBLIC_APP_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? '8787'}`}/paypal/demo-checkout?paymentId=${encodeURIComponent(payment.id)}`
      } else {
        const paypalOrder = await createPayPalOrder(approval, payment)
        payment.paypalOrderId = paypalOrder.orderId
        payment.approvalUrl = paypalOrder.approvalUrl
      }
      payment.updatedAt = new Date().toISOString()
      await persistence.savePayment(payment)
      sendJson(response, 201, publicPayment(payment))
      return
    }

    const captureMatch = url.pathname.match(/^\/api\/payments\/([^/]+)\/capture$/)
    if (request.method === 'POST' && captureMatch) {
      if (!demoMode && !isPayPalConfigured()) {
        sendJson(response, 503, { error: 'PayPal is not configured.' })
        return
      }
      const payment = await persistence.getPayment(captureMatch[1])
      if (!payment) {
        sendJson(response, 404, { error: 'Payment not found' })
        return
      }
      if (payment.status === 'paid') {
        sendJson(response, 200, publicPayment(payment))
        return
      }
      if (demoMode) {
        payment.status = 'paid'
      } else {
        const result = await capturePayPalOrder(payment)
        if (result.status !== 'COMPLETED') {
          payment.status = 'failed'
          payment.failureReason = `PayPal returned status ${result.status ?? 'unknown'}`
          payment.updatedAt = new Date().toISOString()
          sendJson(response, 502, publicPayment(payment))
          return
        }
      }
      payment.updatedAt = new Date().toISOString()
      await persistence.savePayment(payment)
      if (payment.status === 'paid') {
        const approval = await persistence.getApproval(payment.approvalId)
        void notifyMissionFunded({
          missionId: approval?.snapshot.missionId ?? payment.approvalId,
          paymentId: payment.id,
          paypalOrderId: payment.paypalOrderId,
          amountMinor: payment.amountMinor,
          currencyCode: payment.currencyCode,
          fundedAt: payment.updatedAt,
        })
      }
      sendJson(response, 200, publicPayment(payment))
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/paypal/webhooks') {
      const rawBody = await readBody(request)
      const verification = await verifyPayPalWebhook(rawBody, request.headers)
      if (!verification.verified || !verification.event?.id) {
        sendJson(response, 400, { error: verification.reason ?? 'PayPal webhook could not be verified.' })
        return
      }

      const event = verification.event
      const eventId = event.id
      if (!eventId) {
        sendJson(response, 400, { error: 'PayPal webhook event id is missing.' })
        return
      }
      const firstReceipt = await persistence.recordWebhook(eventId, JSON.parse(rawBody))
      if (!firstReceipt) {
        sendJson(response, 200, { received: true, duplicate: true })
        return
      }

      let applied = false
      if (event.eventType === PAYPAL_CAPTURE_COMPLETED_EVENT) {
        const paypalOrderId = extractPayPalOrderId(event)
        if (paypalOrderId) {
          const payment = await persistence.getPaymentByPayPalOrder(paypalOrderId)
          if (payment && payment.status !== 'paid') {
            payment.status = 'paid'
            payment.updatedAt = new Date().toISOString()
            await persistence.savePayment(payment)
            applied = true
            const approval = await persistence.getApproval(payment.approvalId)
            void notifyMissionFunded({
              missionId: approval?.snapshot.missionId ?? payment.approvalId,
              paymentId: payment.id,
              paypalOrderId,
              amountMinor: payment.amountMinor,
              currencyCode: payment.currencyCode,
              fundedAt: payment.updatedAt,
            })
          }
        }
      }
      sendJson(response, 200, { received: true, applied, eventType: event.eventType })
      return
    }

    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      await serveFrontend(url.pathname, response)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    sendJson(response, 400, { error: message })
  }
}

const server = createServer((request, response) => {
  void handle(request, response)
})

async function start(): Promise<void> {
  await persistence.initialize()
  server.listen(port, '0.0.0.0', () => {
    console.log(`Mosaic API listening on http://127.0.0.1:${port} (${demoMode ? 'demo' : 'live'} mode, ${process.env.DATABASE_URL ? 'postgres' : 'memory'} store)`)
  })
}

process.once('SIGTERM', () => {
  server.close(() => {
    void persistence.close()
  })
})

void start().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
