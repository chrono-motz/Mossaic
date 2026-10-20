import { describe, expect, it, vi } from 'vitest';
import { MISSION_FUNDED_EVENT, notifyMissionFunded } from './automation';
const event = {
    missionId: 'mission-01',
    paymentId: 'payment-01',
    paypalOrderId: 'order-01',
    amountMinor: 4200,
    currencyCode: 'usd',
    fundedAt: '2026-10-20T12:00:00.000Z',
};
describe('mission-funded automation notifier', () => {
    it('skips cleanly when Zapier is not configured', async () => {
        const fetchMock = vi.fn();
        const result = await notifyMissionFunded(event, { env: {}, fetch: fetchMock });
        expect(result).toEqual({ sent: false, skipped: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('posts a normalized mission-funded event to the configured webhook', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        const result = await notifyMissionFunded(event, {
            env: { ZAPIER_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/test' },
            fetch: fetchMock,
        });
        expect(result).toEqual({ sent: true, skipped: false, status: 200 });
        expect(fetchMock).toHaveBeenCalledWith('https://hooks.zapier.com/hooks/catch/test', expect.objectContaining({ method: 'POST' }));
        const request = fetchMock.mock.calls[0][1];
        expect(JSON.parse(String(request.body))).toEqual({
            event: MISSION_FUNDED_EVENT,
            missionId: 'mission-01',
            paymentId: 'payment-01',
            paypalOrderId: 'order-01',
            amountMinor: 4200,
            currencyCode: 'USD',
            fundedAt: '2026-10-20T12:00:00.000Z',
        });
    });
    it('swallows webhook transport failures so payment flow can continue', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
        await expect(notifyMissionFunded(event, {
            webhookUrl: 'https://hooks.zapier.com/hooks/catch/test',
            fetch: fetchMock,
        })).resolves.toEqual({ sent: false, skipped: false, error: 'request-failed' });
    });
});
//# sourceMappingURL=automation.test.js.map