export const MISSION_FUNDED_EVENT = 'mission.funded';
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function eventFromInput(input) {
    const missionId = nonEmptyString(input.missionId);
    const paymentId = nonEmptyString(input.paymentId);
    const paypalOrderId = nonEmptyString(input.paypalOrderId) ?? nonEmptyString(input.orderId);
    const currencyCode = nonEmptyString(input.currencyCode)?.toUpperCase();
    if (!missionId || !paymentId || !currencyCode || !/^[A-Z]{3}$/.test(currencyCode))
        throw new Error('Mission-funded event identifiers and currency are invalid');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0)
        throw new Error('Mission-funded event amount is invalid');
    const fundedAt = nonEmptyString(input.fundedAt) ?? new Date().toISOString();
    if (Number.isNaN(new Date(fundedAt).getTime()))
        throw new Error('Mission-funded event timestamp is invalid');
    return {
        event: MISSION_FUNDED_EVENT,
        missionId,
        paymentId,
        ...(paypalOrderId ? { paypalOrderId } : {}),
        amountMinor: input.amountMinor,
        currencyCode,
        fundedAt: new Date(fundedAt).toISOString(),
    };
}
function webhookUrl(options) {
    const env = options.env ?? process.env;
    return nonEmptyString(options.webhookUrl) ?? nonEmptyString(env.ZAPIER_WEBHOOK_URL);
}
function validHttpUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return undefined;
        return parsed.toString();
    }
    catch {
        return undefined;
    }
}
/**
 * Sends a mission-funded event to Zapier when configured. Delivery errors are
 * represented in the result and never rejected, so payment state transitions
 * remain independent from optional automation.
 */
export async function notifyMissionFunded(input, options = {}) {
    const configuredUrl = webhookUrl(options);
    if (!configuredUrl)
        return { sent: false, skipped: true };
    let event;
    try {
        event = eventFromInput(input);
    }
    catch {
        return { sent: false, skipped: false, error: 'invalid-event' };
    }
    const url = validHttpUrl(configuredUrl);
    if (!url)
        return { sent: false, skipped: false, error: 'invalid-webhook-url' };
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl)
        return { sent: false, skipped: false, error: 'no-fetch' };
    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(event),
        });
        if (!response.ok)
            return { sent: false, skipped: false, status: response.status, error: 'non-success-response' };
        return { sent: true, skipped: false, status: response.status };
    }
    catch {
        return { sent: false, skipped: false, error: 'request-failed' };
    }
}
export function isMissionFundedAutomationConfigured(env = process.env) {
    return Boolean(nonEmptyString(env.ZAPIER_WEBHOOK_URL));
}
//# sourceMappingURL=automation.js.map