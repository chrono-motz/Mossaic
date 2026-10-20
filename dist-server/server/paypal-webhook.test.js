import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PAYPAL_SIGNATURE, DEMO_PAYPAL_SIGNATURE_HEADER, extractPayPalOrderId, PAYPAL_CAPTURE_COMPLETED_EVENT, verifyPayPalWebhook, } from './paypal-webhook';
const captureEvent = {
    id: 'WH-test-01',
    event_type: PAYPAL_CAPTURE_COMPLETED_EVENT,
    resource_type: 'capture',
    resource: {
        id: 'capture-01',
        supplementary_data: { related_ids: { order_id: 'order-01' } },
    },
};
afterEach(() => {
    vi.restoreAllMocks();
});
describe('PayPal webhook boundary', () => {
    it('accepts only the explicit demo signature when live credentials are absent', async () => {
        const fetchMock = vi.fn();
        const rawEvent = JSON.stringify(captureEvent);
        const accepted = await verifyPayPalWebhook(rawEvent, {
            [DEMO_PAYPAL_SIGNATURE_HEADER]: DEMO_PAYPAL_SIGNATURE,
        }, { env: { DEMO_MODE: 'true' }, fetch: fetchMock });
        const rejected = await verifyPayPalWebhook(rawEvent, {}, { env: { DEMO_MODE: 'true' }, fetch: fetchMock });
        expect(accepted).toMatchObject({ verified: true, mode: 'demo' });
        expect(accepted.event?.eventType).toBe(PAYPAL_CAPTURE_COMPLETED_EVENT);
        expect(extractPayPalOrderId(accepted.event)).toBe('order-01');
        expect(rejected).toMatchObject({ verified: false, mode: 'demo' });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('uses PayPal OAuth and REST signature verification when all webhook credentials exist', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'test-access-token' }) })
            .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }) });
        const headers = {
            'paypal-auth-algo': 'SHA256withRSA',
            'paypal-cert-url': 'https://api-m.paypal.com/cert/test',
            'paypal-transmission-id': 'transmission-01',
            'paypal-transmission-sig': 'signature-01',
            'paypal-transmission-time': '2026-10-20T12:00:00Z',
        };
        const result = await verifyPayPalWebhook(JSON.stringify(captureEvent), headers, {
            env: {
                DEMO_MODE: 'false',
                PAYPAL_CLIENT_ID: 'test-client-id',
                PAYPAL_CLIENT_SECRET: 'test-client-secret',
                PAYPAL_WEBHOOK_ID: 'test-webhook-id',
            },
            fetch: fetchMock,
        });
        expect(result).toMatchObject({ verified: true, mode: 'paypal-rest' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
        expect(fetchMock.mock.calls[1][0]).toBe('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
        const verificationRequest = fetchMock.mock.calls[1][1];
        expect(JSON.parse(String(verificationRequest.body))).toMatchObject({
            webhook_id: 'test-webhook-id',
            webhook_event: captureEvent,
        });
    });
    it('does not expose an order id for a non-completed capture event', () => {
        expect(extractPayPalOrderId({
            ...captureEvent,
            event_type: 'PAYMENT.CAPTURE.PENDING',
        })).toBeUndefined();
    });
});
//# sourceMappingURL=paypal-webhook.test.js.map