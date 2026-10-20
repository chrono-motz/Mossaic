const PAYPAL_SANDBOX_API = 'https://api-m.sandbox.paypal.com';
const PAYPAL_LIVE_API = 'https://api-m.paypal.com';
export const PAYPAL_CAPTURE_COMPLETED_EVENT = 'PAYMENT.CAPTURE.COMPLETED';
export const DEMO_PAYPAL_SIGNATURE_HEADER = 'x-demo-paypal-signature';
export const DEMO_PAYPAL_SIGNATURE = 'mosaic-demo-paypal-signature-v1';
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
];
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function environmentValue(env, name) {
    return nonEmptyString(env[name]);
}
function rawEventText(rawEvent) {
    if (typeof rawEvent === 'string') {
        if (!rawEvent.trim())
            throw new Error('PayPal webhook body is empty');
        return rawEvent;
    }
    if (rawEvent instanceof Uint8Array) {
        const text = new TextDecoder().decode(rawEvent);
        if (!text.trim())
            throw new Error('PayPal webhook body is empty');
        return text;
    }
    const encoded = JSON.stringify(rawEvent);
    if (!encoded)
        throw new Error('PayPal webhook body must be JSON');
    return encoded;
}
function parseRawEvent(rawEvent) {
    const body = rawEventText(rawEvent);
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        throw new Error('PayPal webhook body must be valid JSON');
    }
    if (!isRecord(parsed))
        throw new Error('PayPal webhook body must be a JSON object');
    return { body, value: parsed };
}
function eventType(value) {
    return typeof value === 'string' && PAYPAL_EVENT_TYPES.includes(value)
        ? value
        : 'UNKNOWN';
}
export function isPayPalWebhookEventType(value) {
    return value === 'UNKNOWN' || (typeof value === 'string' && PAYPAL_EVENT_TYPES.includes(value));
}
/** Converts an untrusted provider payload into a small, typed event boundary. */
export function normalizePayPalWebhookEvent(rawEvent) {
    const { value } = parseRawEvent(rawEvent);
    const suppliedType = nonEmptyString(value.event_type) ?? nonEmptyString(value.eventType);
    const normalizedType = eventType(suppliedType);
    const resource = isRecord(value.resource) ? { ...value.resource } : {};
    const normalized = {
        ...(nonEmptyString(value.id) ? { id: nonEmptyString(value.id) } : {}),
        eventType: normalizedType,
        event_type: normalizedType,
        ...(normalizedType === 'UNKNOWN' && suppliedType ? { rawEventType: suppliedType } : {}),
        ...(nonEmptyString(value.resource_type) ? { resourceType: nonEmptyString(value.resource_type), resource_type: nonEmptyString(value.resource_type) } : {}),
        ...(nonEmptyString(value.summary) ? { summary: nonEmptyString(value.summary) } : {}),
        ...(nonEmptyString(value.create_time) ? { createTime: nonEmptyString(value.create_time), create_time: nonEmptyString(value.create_time) } : {}),
        resource,
    };
    return normalized;
}
function headerValue(headers, name) {
    const headerName = name.toLowerCase();
    if (typeof headers === 'object' && headers !== null) {
        const getter = headers.get;
        if (typeof getter === 'function')
            return nonEmptyString(getter.call(headers, name));
        for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() !== headerName)
                continue;
            if (Array.isArray(value))
                return nonEmptyString(value[0]);
            return nonEmptyString(value);
        }
    }
    return undefined;
}
function demoModeEnabled(env) {
    return environmentValue(env, 'DEMO_MODE')?.toLowerCase() !== 'false';
}
function hasAnyPayPalCredential(env) {
    return Boolean(environmentValue(env, 'PAYPAL_CLIENT_ID')
        || environmentValue(env, 'PAYPAL_CLIENT_SECRET')
        || environmentValue(env, 'PAYPAL_WEBHOOK_ID'));
}
export function isPayPalWebhookVerificationConfigured(env = process.env) {
    return Boolean(environmentValue(env, 'PAYPAL_CLIENT_ID')
        && environmentValue(env, 'PAYPAL_CLIENT_SECRET')
        && environmentValue(env, 'PAYPAL_WEBHOOK_ID'));
}
function paypalApiBase(env, override) {
    const configured = nonEmptyString(override)
        ?? environmentValue(env, 'PAYPAL_API_BASE_URL')
        ?? environmentValue(env, 'PAYPAL_BASE_URL');
    if (configured)
        return configured.replace(/\/$/, '');
    const environment = environmentValue(env, 'PAYPAL_ENVIRONMENT')?.toLowerCase();
    return environment === 'live' || environment === 'production' ? PAYPAL_LIVE_API : PAYPAL_SANDBOX_API;
}
function failure(mode, event, reason) {
    return { verified: false, mode, ...(event ? { event } : {}), reason };
}
async function jsonResponse(response) {
    try {
        return await response.json();
    }
    catch {
        return undefined;
    }
}
async function verifyWithPayPalRest(event, providerEvent, headers, clientId, clientSecret, webhookId, env, options) {
    const requiredHeaders = {
        authAlgo: headerValue(headers, 'paypal-auth-algo'),
        certUrl: headerValue(headers, 'paypal-cert-url'),
        transmissionId: headerValue(headers, 'paypal-transmission-id'),
        transmissionSig: headerValue(headers, 'paypal-transmission-sig'),
        transmissionTime: headerValue(headers, 'paypal-transmission-time'),
    };
    if (Object.values(requiredHeaders).some((value) => !value)) {
        return failure('paypal-rest', event, 'PayPal verification headers are incomplete');
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl)
        return failure('paypal-rest', event, 'No fetch implementation is available');
    const baseUrl = paypalApiBase(env, options.apiBaseUrl);
    let accessToken;
    try {
        const tokenResponse = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!tokenResponse.ok)
            return failure('paypal-rest', event, `PayPal OAuth returned HTTP ${tokenResponse.status}`);
        const tokenPayload = await jsonResponse(tokenResponse);
        accessToken = isRecord(tokenPayload) ? nonEmptyString(tokenPayload.access_token) : undefined;
        if (!accessToken)
            return failure('paypal-rest', event, 'PayPal OAuth did not return an access token');
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
        });
        if (!verificationResponse.ok)
            return failure('paypal-rest', event, `PayPal webhook verification returned HTTP ${verificationResponse.status}`);
        const verificationPayload = await jsonResponse(verificationResponse);
        const status = isRecord(verificationPayload) ? nonEmptyString(verificationPayload.verification_status) : undefined;
        if (status !== 'SUCCESS')
            return failure('paypal-rest', event, 'PayPal webhook signature was not accepted');
        return { verified: true, mode: 'paypal-rest', event };
    }
    catch {
        return failure('paypal-rest', event, 'PayPal webhook verification request failed');
    }
}
/**
 * Verifies a raw PayPal webhook body and returns its normalized event only when
 * the provider (or the explicit local demo signature) accepts it.
 */
export async function verifyPayPalWebhook(rawEvent, headers, options = {}) {
    let parsed;
    let event;
    try {
        parsed = parseRawEvent(rawEvent);
        event = normalizePayPalWebhookEvent(parsed.value);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : 'PayPal webhook body is invalid';
        return failure('unconfigured', undefined, reason);
    }
    const env = options.env ?? process.env;
    const clientId = environmentValue(env, 'PAYPAL_CLIENT_ID');
    const clientSecret = environmentValue(env, 'PAYPAL_CLIENT_SECRET');
    const webhookId = environmentValue(env, 'PAYPAL_WEBHOOK_ID');
    if (clientId && clientSecret && webhookId) {
        return verifyWithPayPalRest(event, parsed.value, headers, clientId, clientSecret, webhookId, env, options);
    }
    if (hasAnyPayPalCredential(env)) {
        return failure('unconfigured', event, 'PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_WEBHOOK_ID must be configured together');
    }
    if (!demoModeEnabled(env))
        return failure('unconfigured', event, 'PayPal webhook verification is not configured');
    const signatureHeader = options.demoSignatureHeader ?? DEMO_PAYPAL_SIGNATURE_HEADER;
    const expectedSignature = options.demoSignature ?? DEMO_PAYPAL_SIGNATURE;
    if (headerValue(headers, signatureHeader) !== expectedSignature) {
        return failure('demo', event, `Missing or invalid ${signatureHeader} demo signature`);
    }
    return { verified: true, mode: 'demo', event };
}
/** Explicit alias for callers that want the raw-event wording in their handler. */
export const verifyRawPayPalEvent = verifyPayPalWebhook;
/** Boolean convenience wrapper for handlers that do not need the normalized event yet. */
export async function isPayPalWebhookVerified(rawEvent, headers, options = {}) {
    return (await verifyPayPalWebhook(rawEvent, headers, options)).verified;
}
function isNormalizedPayPalEvent(value) {
    return isRecord(value)
        && isPayPalWebhookEventType(value.eventType)
        && isRecord(value.resource);
}
function resourceValue(resource, key) {
    return resource[key];
}
/**
 * Extracts the PayPal order id from a completed capture event. Other event
 * types intentionally return undefined so a capture cannot fund a mission by
 * accident.
 */
export function extractPayPalOrderId(event) {
    let normalized;
    try {
        normalized = isNormalizedPayPalEvent(event) ? event : normalizePayPalWebhookEvent(event);
    }
    catch {
        return undefined;
    }
    if (normalized.eventType !== PAYPAL_CAPTURE_COMPLETED_EVENT)
        return undefined;
    const resource = normalized.resource;
    const supplementary = isRecord(resourceValue(resource, 'supplementary_data')) ? resourceValue(resource, 'supplementary_data') : undefined;
    const relatedIds = supplementary && isRecord(supplementary.related_ids) ? supplementary.related_ids : undefined;
    const candidates = [
        relatedIds?.order_id,
        resourceValue(resource, 'order_id'),
        resourceValue(resource, 'orderId'),
        supplementary?.order_id,
    ];
    return candidates.map(nonEmptyString).find((value) => Boolean(value));
}
/** Alias matching the payment-oriented wording used by application handlers. */
export const extractPaymentOrderId = extractPayPalOrderId;
//# sourceMappingURL=paypal-webhook.js.map