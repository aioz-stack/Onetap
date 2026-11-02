// AES-256-GCM for courier credentials at rest. The key lives only in ONETAP_SECRET_KEY.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function key() {
  const value = Buffer.from(process.env.ONETAP_SECRET_KEY || '', 'base64');
  if (value.length !== 32) throw new Error('ONETAP_SECRET_KEY must be 32 bytes in base64. See AGENTS.md.');
  return value;
}

export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
}

export function decrypt(text) {
  const [iv, tag, data] = text.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

export function hmac(secret, text) {
  return createHmac('sha256', secret).update(text).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
