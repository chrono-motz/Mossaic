import { CheckoutPaymentIntent, Client, Environment, OrderApplicationContextUserAction, OrdersController, } from '@paypal/paypal-server-sdk';
function requiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value)
        throw new Error(`Missing required environment variable: ${name}`);
    return value;
}
function paypalController() {
    const client = new Client({
        environment: Environment.Sandbox,
        clientCredentialsAuthCredentials: {
            oAuthClientId: requiredEnv('PAYPAL_CLIENT_ID'),
            oAuthClientSecret: requiredEnv('PAYPAL_CLIENT_SECRET'),
        },
    });
    return new OrdersController(client);
}
function publicOrigin() {
    return (process.env.PUBLIC_APP_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || `http://127.0.0.1:${process.env.PORT ?? '8787'}`).replace(/\/$/, '');
}
function amountValue(payment) {
    if (!Number.isSafeInteger(payment.amountMinor) || payment.amountMinor <= 0)
        throw new Error('Payment amount is invalid');
    return (payment.amountMinor / 100).toFixed(2);
}
export async function createPayPalOrder(approval, payment) {
    const controller = paypalController();
    const origin = publicOrigin();
    const body = {
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
    };
    const response = await controller.createOrder({
        body,
        prefer: 'return=representation',
        paypalRequestId: payment.createIdempotencyKey,
    });
    const order = response.result;
    const approvalUrl = order?.links?.find((link) => link.rel === 'approve')?.href;
    if (!order?.id || !approvalUrl)
        throw new Error('PayPal did not return an approval link');
    return { orderId: order.id, approvalUrl, status: order.status };
}
export async function capturePayPalOrder(payment) {
    if (!payment.paypalOrderId)
        throw new Error('PayPal order is missing');
    const response = await paypalController().captureOrder({
        id: payment.paypalOrderId,
        body: {},
        prefer: 'return=representation',
        paypalRequestId: payment.captureIdempotencyKey,
    });
    return { status: response.result?.status };
}
export function isPayPalConfigured() {
    return Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim());
}
//# sourceMappingURL=paypal.js.map