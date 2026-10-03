import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, enabled, env, required, rpc } from './runtime';

type Json = Record<string, any>;
export function paypalBase(): string {
  if (env('PAYPAL_ENVIRONMENT') !== 'live') return 'https://api-m.sandbox.paypal.com';
  if (!enabled('SERVER_PAYPAL_LIVE_APPROVED') && !enabled('PAYPAL_LIVE_APPROVED')) throw new ApiError(503, 'Las compras reales todavía no están habilitadas.');
  return 'https://api-m.paypal.com';
}
async function paypal<T>(path: string, method = 'GET', body?: unknown, requestId?: string): Promise<T> {
  const auth = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${btoa(`${required('PAYPAL_CLIENT_ID')}:${required('PAYPAL_CLIENT_SECRET')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10000) });
  if (!auth.ok) throw new ApiError(503, 'PayPal no respondió.');
  const token = await auth.json() as { access_token: string };
  const response = await fetch(`${paypalBase()}${path}`, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new ApiError(503, 'PayPal no pudo completar la operación.');
  return response.json() as Promise<T>;
}
function providerId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Z0-9]{8,40}$/.test(value)) throw new ApiError(400, 'Pago inválido.'); return value; }
export function amountCents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,8}\.\d{2}$/.test(value)) throw new ApiError(400, 'Importe inválido.');
  return Number(value.replace('.', ''));
}
export async function createOrder(db: SupabaseClient, userId: string, payload: Record<string, unknown>): Promise<unknown> {
  const order = await rpc<Json>(db, 'paypal-order', userId, payload);
  if (order.orderId) return { orderId: order.orderId, approvalUrl: order.approvalUrl };
  const app = new URL(required('APP_URL'));
  const created = await paypal<Json>('/v2/checkout/orders', 'POST', { intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.id, payee: { merchant_id: required('PAYPAL_MERCHANT_ID') }, description: `Impossible Tower · ${order.coins} coins`, amount: { currency_code: order.currency, value: (order.amountCents / 100).toFixed(2) } }], payment_source: { paypal: { experience_context: { return_url: new URL('?paypal=return', app).href, cancel_url: new URL('?paypal=cancel', app).href, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } } }, order.id);
  const approval = created.links?.find((link: Json) => ['approve', 'payer-action'].includes(link.rel));
  if (!approval || !/^https:\/\/(www\.)?(sandbox\.)?paypal\.com\//.test(approval.href)) throw new ApiError(503, 'PayPal no devolvió una aprobación.');
  return rpc(db, 'paypal-attach', userId, { id: order.id, orderId: providerId(created.id), approvalUrl: approval.href });
}
export async function captureOrder(db: SupabaseClient, userId: string, orderId: unknown): Promise<unknown> {
  const id = providerId(orderId);
  const order = await rpc<Json>(db, 'paypal-find', userId, { orderId: id });
  if (order.status === 'created') {
    let current = await paypal<Json>(`/v2/checkout/orders/${id}`);
    if (current.status !== 'COMPLETED') {
      const capture = await paypal<Json>(`/v2/checkout/orders/${id}/capture`, 'POST', {}, `capture:${order.id}`);
      if (capture.status !== 'COMPLETED') throw new ApiError(409, 'El pago sigue pendiente.');
      current = await paypal<Json>(`/v2/checkout/orders/${id}`);
    }
    const captureId = current.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    await recordCapture(db, await captureDetails(providerId(captureId)), current);
  }
  return rpc(db, 'snapshot', userId);
}
async function captureDetails(id: string): Promise<Json> { return paypal(`/v2/payments/captures/${providerId(id)}`); }
async function verifiedOrder(db: SupabaseClient, capture: Json, providerOrder?: Json): Promise<Json> {
  const id = providerId(capture.supplementary_data?.related_ids?.order_id);
  const local = await rpc<Json>(db, 'payment-order', null, { orderId: id });
  const order = providerOrder || await paypal<Json>(`/v2/checkout/orders/${id}`);
  const units = order.purchase_units;
  const unit = units?.[0];
  if (order.id !== id || !Array.isArray(units) || units.length !== 1 || unit.custom_id !== local.id || unit.reference_id !== local.id || unit.payee?.merchant_id !== required('PAYPAL_MERCHANT_ID') || (capture.payee?.merchant_id && capture.payee.merchant_id !== required('PAYPAL_MERCHANT_ID')) || unit.amount?.currency_code !== local.currency || capture.amount?.currency_code !== local.currency || amountCents(unit.amount?.value) !== local.amountCents || amountCents(capture.amount?.value) !== local.amountCents || !Array.isArray(unit.payments?.captures) || unit.payments.captures.length !== 1 || unit.payments.captures[0].id !== capture.id) throw new ApiError(400, 'El pago no coincide con la compra.');
  return local;
}
async function recordCapture(db: SupabaseClient, capture: Json, providerOrder?: Json): Promise<void> {
  const local = await verifiedOrder(db, capture, providerOrder);
  if (capture.status !== 'COMPLETED') {
    if (['REFUNDED', 'PARTIALLY_REFUNDED'].includes(capture.status) && local.status !== 'created') return;
    throw new ApiError(409, 'El pago espera conciliación.');
  }
  await rpc(db, 'payment-event', null, { eventId: `capture:${capture.id}`, kind: 'paid', orderId: local.orderId, captureId: capture.id, amountCents: amountCents(capture.amount?.value), currency: capture.amount?.currency_code });
}
export async function receiveWebhook(db: SupabaseClient, request: Request, event: Json): Promise<void> {
  const keys = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (keys.some(key => !request.headers.get(key))) throw new ApiError(400, 'Firma incompleta.');
  const verification = await paypal<Json>('/v1/notifications/verify-webhook-signature', 'POST', { auth_algo: request.headers.get(keys[0]), cert_url: request.headers.get(keys[1]), transmission_id: request.headers.get(keys[2]), transmission_sig: request.headers.get(keys[3]), transmission_time: request.headers.get(keys[4]), webhook_id: required('PAYPAL_WEBHOOK_ID'), webhook_event: event });
  if (verification.verification_status !== 'SUCCESS') throw new ApiError(403, 'Firma inválida.');
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const capture = await captureDetails(event.resource.id);
    await recordCapture(db, capture);
  } else if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
    const refund = await paypal<Json>(`/v2/payments/refunds/${providerId(event.resource.id)}`);
    if (refund.status !== 'COMPLETED') throw new ApiError(409, 'Reembolso todavía pendiente.');
    const up = refund.links?.find((link: Json) => link.rel === 'up');
    const match = typeof up?.href === 'string' ? new URL(up.href).pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/) : null;
    if (!match) throw new ApiError(400, 'Captura de reembolso inválida.');
    const capture = await captureDetails(match[1]);
    await verifiedOrder(db, capture);
    await rpc(db, 'payment-event', null, { eventId: `refund:${refund.id}`, kind: 'refund', orderId: providerId(capture.supplementary_data?.related_ids?.order_id), captureId: capture.id, refundCents: amountCents(refund.amount?.value), originalAmountCents: amountCents(capture.amount?.value), currency: refund.amount?.currency_code });
  } else if (event.event_type === 'PAYMENT.CAPTURE.REVERSED') {
    const capture = await captureDetails(event.resource.id);
    await verifiedOrder(db, capture);
    await rpc(db, 'payment-event', null, { eventId: `reversal:${capture.id}`, kind: 'reversal', orderId: providerId(capture.supplementary_data?.related_ids?.order_id), captureId: capture.id, refundedCents: amountCents(capture.amount?.value), originalAmountCents: amountCents(capture.amount?.value), currency: capture.amount?.currency_code });
  }
}
