import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrderApplicationContextUserAction,
  OrdersController,
} from '@paypal/paypal-server-sdk'
import type { OrderRequest } from '@paypal/paypal-server-sdk'
import type { ApprovalRecord, PaymentRecord } from './store.js'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function paypalController(): OrdersController {
  const client = new Client({
    environment: Environment.Sandbox,
    clientCredentialsAuthCredentials: {
      oAuthClientId: requiredEnv('PAYPAL_CLIENT_ID'),
      oAuthClientSecret: requiredEnv('PAYPAL_CLIENT_SECRET'),
    },
  })
  return new OrdersController(client)
}

function publicOrigin(): string {
  return (process.env.PUBLIC_APP_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? '8787'}`).replace(/\/$/, '')
}

function amountValue(payment: PaymentRecord): string {
  if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0) throw new Error('Payment amount is invalid')
  return (payment.amountMinor / 100).toFixed(2)
}

export async function createPayPalOrder(approval: ApprovalRecord, payment: PaymentRecord): Promise<{ orderId: string; approvalUrl: string; status: string | undefined }> {
  const controller = paypalController()
  const origin = publicOrigin()
  const body: OrderRequest = {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [{
      customId: approval.id,
      invoiceId: payment.id,
      description: `Mosaic mission ${approval.snapshot.missionId}`,
      amount: {
        currencyCode: payment.currencyCode,
        value: amountValue(payment),
      },
    }],
    applicationContext: {
      brandName: 'Mosaic',
      userAction: OrderApplicationContextUserAction.PayNow,
      returnUrl: `${origin}/paypal/return?paymentId=${encodeURIComponent(payment.id)}`,
      cancelUrl: `${origin}/paypal/cancel?paymentId=${encodeURIComponent(payment.id)}`,
    },
  }
  const response = await controller.createOrder({
    body,
    prefer: 'return=representation',
    paypalRequestId: payment.createIdempotencyKey,
  })
  const order = response.result
  const approvalUrl = order?.links?.find((link) => link.rel === 'approve')?.href
  if (!order?.id || !approvalUrl) throw new Error('PayPal did not return an approval link')
  return { orderId: order.id, approvalUrl, status: order.status }
}

export async function capturePayPalOrder(payment: PaymentRecord): Promise<{ status: string | undefined }> {
  if (!payment.paypalOrderId) throw new Error('PayPal order is missing')
  const response = await paypalController().captureOrder({
    id: payment.paypalOrderId,
    body: {},
    prefer: 'return=representation',
    paypalRequestId: payment.captureIdempotencyKey,
  })
  return { status: response.result?.status }
}

export function isPayPalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim())
}
