import { expect, test } from '@playwright/test'

test('mission room renders the sponsor surfaces and gates PayPal behind approval', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('MOSAIC', { exact: true })).toBeVisible()
  await expect(page.getByText('Three ways to make it happen')).toBeVisible()
  await expect(page.getByTestId('bryntum-timeline')).toBeVisible()
  await expect(page.getByText('Channel3', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: /Create PayPal order/i })).not.toBeVisible()
  await page.getByRole('button', { name: /Approve this plan/i }).click()
  await expect(page.getByRole('button', { name: /Create PayPal order/i })).toBeVisible()
  await page.getByRole('button', { name: /Create PayPal order/i }).click()
  await expect(page.getByRole('button', { name: /Complete Sandbox Checkout/i })).toBeVisible()
  await page.getByRole('button', { name: /Complete Sandbox Checkout/i }).click()
  await expect(page.getByText('Payment captured', { exact: true })).toBeVisible()
  await expect(page.getByText('Mission funded')).toBeVisible()
})

test('API rejects a tampered approval hash and makes order creation idempotent', async ({ request }) => {
  const compileResponse = await request.post('/api/compile', {
    data: { missionId: 'api-test-mission', brief: 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.' },
  })
  expect(compileResponse.status()).toBe(200)
  const compiled = await compileResponse.json() as { planner: string; catalogSource: string; plans: unknown[]; planHashes: Record<string, string> }
  expect(compiled).toMatchObject({ planner: 'demo', catalogSource: 'demo-catalog' })
  expect(compiled.plans).toHaveLength(3)

  const staleApprovalResponse = await request.post('/api/approvals', {
    data: {
      missionId: 'api-test-mission',
      brief: 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.',
      planKind: 'fastest',
      expectedPlanHash: 'stale-plan-hash',
    },
  })
  expect(staleApprovalResponse.status()).toBe(400)

  const approvalResponse = await request.post('/api/approvals', {
    data: {
      missionId: 'api-test-mission',
      brief: 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.',
      planKind: 'fastest',
      expectedPlanHash: compiled.planHashes.fastest,
    },
  })
  expect(approvalResponse.status()).toBe(201)
  const approval = await approvalResponse.json() as { approvalId: string; planHash: string }

  const tamperedResponse = await request.post('/api/missions/api-test-mission/paypal/orders', {
    headers: { 'Idempotency-Key': 'tampered-request' },
    data: { approvalId: approval.approvalId, planHash: 'tampered' },
  })
  expect(tamperedResponse.status()).toBe(409)

  const idempotencyHeaders = { 'Idempotency-Key': 'api-test-request' }
  const firstOrderResponse = await request.post('/api/missions/api-test-mission/paypal/orders', {
    headers: idempotencyHeaders,
    data: { approvalId: approval.approvalId, planHash: approval.planHash },
  })
  expect(firstOrderResponse.status()).toBe(201)
  const firstOrder = await firstOrderResponse.json() as { paymentId: string; paypalOrderId: string }

  const retryResponse = await request.post('/api/missions/api-test-mission/paypal/orders', {
    headers: idempotencyHeaders,
    data: { approvalId: approval.approvalId, planHash: approval.planHash },
  })
  expect(retryResponse.status()).toBe(200)
  const retryOrder = await retryResponse.json() as { paymentId: string; paypalOrderId: string }
  expect(retryOrder).toMatchObject({
    paymentId: firstOrder.paymentId,
    paypalOrderId: firstOrder.paypalOrderId,
  })

  const captureResponse = await request.post(`/api/payments/${firstOrder.paymentId}/capture`, { data: {} })
  expect(captureResponse.status()).toBe(200)
  const captured = await captureResponse.json() as { status: string }
  expect(captured.status).toBe('paid')

  const webhookCompileResponse = await request.post('/api/compile', {
    data: { missionId: 'webhook-mission', brief: 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.' },
  })
  const webhookCompiled = await webhookCompileResponse.json() as { planHashes: Record<string, string> }
  const webhookApprovalResponse = await request.post('/api/approvals', {
    data: {
      missionId: 'webhook-mission',
      brief: 'Create a heat-relief station for 80 people by 6 PM with a $4,500 budget.',
      planKind: 'fastest',
      expectedPlanHash: webhookCompiled.planHashes.fastest,
    },
  })
  const webhookApproval = await webhookApprovalResponse.json() as { approvalId: string; planHash: string }
  const webhookOrderResponse = await request.post('/api/missions/webhook-mission/paypal/orders', {
    headers: { 'Idempotency-Key': 'webhook-order' },
    data: { approvalId: webhookApproval.approvalId, planHash: webhookApproval.planHash },
  })
  const webhookOrder = await webhookOrderResponse.json() as { paymentId: string; paypalOrderId: string }
  const webhookBody = {
    id: 'WH-e2e-01',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { supplementary_data: { related_ids: { order_id: webhookOrder.paypalOrderId } } },
  }
  const webhookResponse = await request.post('/api/paypal/webhooks', {
    headers: { 'x-demo-paypal-signature': 'mosaic-demo-paypal-signature-v1' },
    data: webhookBody,
  })
  expect(webhookResponse.status()).toBe(200)
  const webhookResult = await webhookResponse.json() as { received: boolean; applied: boolean }
  expect(webhookResult).toMatchObject({ received: true, applied: true })

  const duplicateWebhookResponse = await request.post('/api/paypal/webhooks', {
    headers: { 'x-demo-paypal-signature': 'mosaic-demo-paypal-signature-v1' },
    data: webhookBody,
  })
  expect(duplicateWebhookResponse.status()).toBe(200)
  const duplicateWebhookResult = await duplicateWebhookResponse.json() as { received: boolean; duplicate: boolean }
  expect(duplicateWebhookResult).toMatchObject({ received: true, duplicate: true })
})
