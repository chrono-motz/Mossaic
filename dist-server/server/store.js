import { createHash, randomUUID } from 'node:crypto';
export const approvals = new Map();
export const payments = new Map();
export const paymentsByIdempotencyKey = new Map();
export const paymentIdByPayPalOrder = new Map();
export function canonicalSnapshot(snapshot) {
    return JSON.stringify({
        missionId: snapshot.missionId,
        planId: snapshot.planId,
        currency: snapshot.currency.toUpperCase(),
        total: Number(snapshot.total.toFixed(2)),
        logisticsFee: Number(snapshot.logisticsFee.toFixed(2)),
        items: [...snapshot.items]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice.toFixed(2)),
        })),
    });
}
export function hashSnapshot(snapshot) {
    return createHash('sha256').update(canonicalSnapshot(snapshot)).digest('hex');
}
export function createApproval(snapshot) {
    const now = new Date().toISOString();
    const approval = {
        id: `approval_${randomUUID()}`,
        snapshot,
        planHash: hashSnapshot(snapshot),
        createdAt: now,
        status: 'approved',
    };
    approvals.set(approval.id, approval);
    return approval;
}
export function createPayment(approval, idempotencyKey) {
    const now = new Date().toISOString();
    const payment = {
        id: `payment_${randomUUID()}`,
        approvalId: approval.id,
        planHash: approval.planHash,
        amountMinor: Math.round(approval.snapshot.total * 100),
        currencyCode: approval.snapshot.currency.toUpperCase(),
        status: 'created',
        createIdempotencyKey: idempotencyKey,
        captureIdempotencyKey: `capture_${randomUUID()}`,
        createdAt: now,
        updatedAt: now,
    };
    payments.set(payment.id, payment);
    paymentsByIdempotencyKey.set(idempotencyKey, payment.id);
    return payment;
}
export function publicPayment(payment) {
    return {
        paymentId: payment.id,
        paypalOrderId: payment.paypalOrderId,
        approvalUrl: payment.approvalUrl,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currencyCode: payment.currencyCode,
        provider: payment.paypalOrderId?.startsWith('DEMO-') ? 'demo' : 'paypal',
        failureReason: payment.failureReason,
    };
}
//# sourceMappingURL=store.js.map