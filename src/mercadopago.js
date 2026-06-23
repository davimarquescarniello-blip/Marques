import crypto from 'crypto';

const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_API = 'https://api.mercadopago.com/v1';

export async function createPixPayment({ amount, description, externalReference, email }) {
  const res = await fetch(`${MP_API}/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': externalReference
    },
    body: JSON.stringify({
      transaction_amount: amount,
      description: description || 'Compra MQS Bot',
      payment_method_id: 'pix',
      payer: { email: email || 'comprador@email.com' },
      external_reference: String(externalReference)
    })
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Mercado Pago error ${res.status}: ${errorText}`);
  }
  return res.json();
}

export async function getPayment(paymentId) {
  const res = await fetch(`${MP_API}/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Failed to fetch payment ${paymentId}`);
  return res.json();
}

export function verifyWebhookSignature(req, secret) {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  if (!secret) return true;
  if (!xSignature) return false;
  const parts = xSignature.split(',');
  const ts = parts.find(p => p.startsWith('ts='))?.split('=')[1];
  const hash = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  if (!ts || !hash) return false;
  const manifest = `id:${req.body?.data?.id};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === expected;
}
