// Slack verifies the exact raw HTTP body before parsing.
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifySlackSignature(rawBody: string, timestamp: string, signature: string, secret: string, nowSeconds = Date.now()/1000) {
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac('sha256',secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const supplied = Buffer.from(signature);
  return supplied.length === Buffer.byteLength(expected) && timingSafeEqual(supplied, Buffer.from(expected));
}
// Shared with every natural-language source; keep one identifier/privacy implementation.
export { extractRequestIdentifier as extractSlackIdentifier } from '../services/request-input.js';
